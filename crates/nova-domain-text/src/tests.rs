use super::*;

fn insert(block: u32, offset: u32, text: &str) -> TextCommand {
    TextCommand::InsertText {
        block,
        offset,
        text: text.into(),
        marks: None,
    }
}

fn apply(block: u32, offset: u32, len: u32, mark: Mark) -> TextCommand {
    TextCommand::ApplyMark {
        block,
        offset,
        len,
        mark,
    }
}

/// Troca as diferenças nos dois sentidos, como faria o servidor de sync.
fn sync(a: &mut TextDocument, b: &mut TextDocument) {
    let a_to_b = a.diff_since(&b.state_vector()).unwrap();
    let b_to_a = b.diff_since(&a.state_vector()).unwrap();
    b.apply_remote(&a_to_b).unwrap();
    a.apply_remote(&b_to_a).unwrap();
}

fn pos(block: u32, offset: u32) -> Pos {
    Pos { block, offset }
}

#[test]
fn apagar_intervalo_no_mesmo_paragrafo() {
    let mut doc = TextDocument::from_plain_text(1, "abcdef");
    let events = doc
        .execute(TextCommand::DeleteRange {
            from: pos(0, 1),
            to: pos(0, 4),
        })
        .unwrap();
    assert_eq!(
        events,
        vec![TextEvent::RangeDeleted {
            from: pos(0, 1),
            to: pos(0, 4)
        }]
    );
    assert_eq!(doc.to_plain_text(), "aef");
}

#[test]
fn apagar_intervalo_entre_paragrafos_une_as_pontas() {
    let mut doc = TextDocument::from_plain_text(1, "primeiro\nmeio\noutro meio\nultimo");
    doc.execute(apply(3, 0, 6, Mark::Bold)).unwrap();
    doc.execute(TextCommand::DeleteRange {
        from: pos(0, 4),
        to: pos(3, 2),
    })
    .unwrap();

    assert_eq!(doc.blocks(), vec!["primtimo"]);
    let spans = doc.block_spans(0).unwrap();
    assert_eq!(texts(&spans), vec!["prim", "timo"]);
    assert!(spans[1].has(MarkKind::Bold));

    // Um único passo de desfazer restaura tudo.
    doc.execute(TextCommand::Undo).unwrap();
    assert_eq!(doc.block_count(), 4);
    assert_eq!(doc.to_plain_text(), "primeiro\nmeio\noutro meio\nultimo");
}

#[test]
fn intervalo_invalido_nao_altera_nada() {
    let mut doc = TextDocument::from_plain_text(1, "abc\ndef");
    assert_eq!(
        doc.execute(TextCommand::DeleteRange {
            from: pos(1, 0),
            to: pos(0, 1)
        }),
        Err(DomainError::InvalidRange)
    );
    assert!(doc
        .execute(TextCommand::DeleteRange {
            from: pos(0, 1),
            to: pos(1, 9)
        })
        .is_err());
    assert_eq!(doc.to_plain_text(), "abc\ndef");
}

#[test]
fn batch_vira_um_passo_de_desfazer() {
    let mut doc = TextDocument::from_plain_text(1, "um\ndois");
    let events = doc
        .execute(TextCommand::Batch {
            commands: vec![apply(0, 0, 2, Mark::Bold), apply(1, 0, 4, Mark::Bold)],
        })
        .unwrap();
    assert_eq!(events.len(), 2);
    assert!(doc.block_spans(1).unwrap()[0].has(MarkKind::Bold));

    doc.execute(TextCommand::Undo).unwrap();
    assert!(doc.block_spans(0).unwrap()[0].marks.is_empty());
    assert!(doc.block_spans(1).unwrap()[0].marks.is_empty());
}

#[test]
fn batch_rejeita_desfazer_e_aninhamento() {
    let mut doc = TextDocument::new(1);
    for inner in [
        TextCommand::Undo,
        TextCommand::Batch {
            commands: Vec::new(),
        },
    ] {
        assert_eq!(
            doc.execute(TextCommand::Batch {
                commands: vec![inner]
            }),
            Err(DomainError::InvalidBatch)
        );
    }
}

fn texts(spans: &[Span]) -> Vec<&str> {
    spans.iter().map(|s| s.text.as_str()).collect()
}

#[test]
fn documento_novo_tem_um_paragrafo_vazio() {
    let doc = TextDocument::new(1);
    assert_eq!(doc.blocks(), vec![""]);
    assert_eq!(doc.block_style(0).unwrap(), BlockStyle::Paragraph);
    assert!(!doc.can_undo());
}

#[test]
fn inserir_e_apagar_emitem_eventos() {
    let mut doc = TextDocument::new(1);
    let events = doc.execute(insert(0, 0, "Olá")).unwrap();
    assert_eq!(
        events,
        vec![TextEvent::TextInserted {
            block: 0,
            offset: 0,
            len: 3
        }]
    );

    let events = doc
        .execute(TextCommand::DeleteText {
            block: 0,
            offset: 1,
            len: 2,
        })
        .unwrap();
    assert_eq!(
        events,
        vec![TextEvent::TextDeleted {
            block: 0,
            offset: 1,
            text: "lá".into()
        }]
    );
    assert_eq!(doc.to_plain_text(), "O");
}

#[test]
fn enter_e_backspace_no_inicio_do_paragrafo() {
    let mut doc = TextDocument::from_plain_text(1, "Primeira linha");
    doc.execute(TextCommand::SplitBlock {
        block: 0,
        offset: 8,
    })
    .unwrap();
    assert_eq!(doc.blocks(), vec!["Primeira", " linha"]);

    let events = doc
        .execute(TextCommand::MergeWithNext { block: 0 })
        .unwrap();
    assert_eq!(events, vec![TextEvent::BlocksMerged { block: 0, at: 8 }]);
    assert_eq!(doc.to_plain_text(), "Primeira linha");
}

#[test]
fn texto_simples_ida_e_volta() {
    let text = "Título\n\nCorpo com acentuação\r\nFim";
    let doc = TextDocument::from_plain_text(1, text);
    assert_eq!(doc.block_count(), 4);
    assert_eq!(doc.to_plain_text(), "Título\n\nCorpo com acentuação\nFim");
}

#[test]
fn offsets_em_utf16_nao_cortam_emoji() {
    let mut doc = TextDocument::from_plain_text(1, "a😀b");
    assert!(matches!(
        doc.execute(insert(0, 2, "X")),
        Err(DomainError::Crdt(CrdtError::InvalidOffset { .. }))
    ));
    doc.execute(insert(0, 3, "X")).unwrap();
    assert_eq!(doc.to_plain_text(), "a😀Xb");
}

#[test]
fn rejeita_comandos_invalidos() {
    let mut doc = TextDocument::new(1);
    assert_eq!(doc.execute(insert(0, 0, "")), Err(DomainError::EmptyText));
    assert_eq!(
        doc.execute(insert(0, 0, "a\nb")),
        Err(DomainError::LineBreakInText)
    );
    assert_eq!(
        doc.execute(TextCommand::RemoveBlock { block: 0 }),
        Err(DomainError::LastBlock)
    );
    assert_eq!(
        doc.execute(insert(5, 0, "x")),
        Err(DomainError::Crdt(CrdtError::BlockNotFound(5)))
    );
}

#[test]
fn marcas_aplicadas_e_removidas() {
    let mut doc = TextDocument::from_plain_text(1, "um dois tres");
    let events = doc.execute(apply(0, 3, 4, Mark::Bold)).unwrap();
    assert_eq!(
        events,
        vec![TextEvent::MarkApplied {
            block: 0,
            offset: 3,
            len: 4,
            mark: Mark::Bold
        }]
    );
    doc.execute(apply(
        0,
        3,
        9,
        Mark::Color {
            value: "#C00000".into(),
        },
    ))
    .unwrap();

    let spans = doc.block_spans(0).unwrap();
    assert_eq!(texts(&spans), vec!["um ", "dois", " tres"]);
    assert!(spans[1].has(MarkKind::Bold) && spans[1].has(MarkKind::Color));
    assert!(!spans[2].has(MarkKind::Bold) && spans[2].has(MarkKind::Color));

    doc.execute(TextCommand::RemoveMark {
        block: 0,
        offset: 0,
        len: 12,
        kind: MarkKind::Color,
    })
    .unwrap();
    let spans = doc.block_spans(0).unwrap();
    assert_eq!(texts(&spans), vec!["um ", "dois", " tres"]);
    assert_eq!(spans[1].marks, vec![Mark::Bold]);
}

#[test]
fn digitacao_herda_marcas_ou_usa_as_informadas() {
    let mut doc = TextDocument::new(1);
    doc.execute(TextCommand::InsertText {
        block: 0,
        offset: 0,
        text: "Aviso".into(),
        marks: Some(vec![Mark::Bold, Mark::FontSize { half_points: 28 }]),
    })
    .unwrap();
    doc.execute(insert(0, 5, ":")).unwrap();
    doc.execute(TextCommand::InsertText {
        block: 0,
        offset: 6,
        text: " leia".into(),
        marks: Some(Vec::new()),
    })
    .unwrap();

    let spans = doc.block_spans(0).unwrap();
    assert_eq!(texts(&spans), vec!["Aviso:", " leia"]);
    assert!(spans[0].has(MarkKind::Bold) && spans[0].has(MarkKind::FontSize));
    assert!(spans[1].marks.is_empty());
}

#[test]
fn marcas_invalidas_sao_rejeitadas() {
    let mut doc = TextDocument::from_plain_text(1, "abc");
    for mark in [
        Mark::Color {
            value: "vermelho".into(),
        },
        Mark::FontSize { half_points: 0 },
        Mark::FontFamily { value: "  ".into() },
    ] {
        assert!(matches!(
            doc.execute(apply(0, 0, 3, mark)),
            Err(DomainError::InvalidMark(_))
        ));
    }
}

#[test]
fn estilos_de_bloco() {
    let mut doc = TextDocument::from_plain_text(1, "Relatório\ncorpo");
    doc.execute(TextCommand::SetBlockStyle {
        block: 0,
        style: BlockStyle::Heading1,
    })
    .unwrap();
    assert_eq!(doc.block_style(0).unwrap(), BlockStyle::Heading1);

    // Enter no fim do título: o novo bloco é parágrafo.
    doc.execute(TextCommand::SplitBlock {
        block: 0,
        offset: 9,
    })
    .unwrap();
    assert_eq!(doc.block_style(1).unwrap(), BlockStyle::Paragraph);

    // Enter no meio do título: as duas metades continuam título.
    doc.execute(TextCommand::SplitBlock {
        block: 0,
        offset: 5,
    })
    .unwrap();
    assert_eq!(doc.blocks(), vec!["Relat", "ório", "", "corpo"]);
    assert_eq!(doc.block_style(1).unwrap(), BlockStyle::Heading1);
}

#[test]
fn desfazer_e_refazer_por_comando() {
    let mut doc = TextDocument::from_plain_text(1, "texto");
    doc.execute(insert(0, 5, " digitado")).unwrap();
    doc.execute(apply(0, 0, 5, Mark::Italic)).unwrap();
    doc.execute(TextCommand::SplitBlock {
        block: 0,
        offset: 5,
    })
    .unwrap();
    assert_eq!(doc.blocks(), vec!["texto", " digitado"]);

    assert_eq!(
        doc.execute(TextCommand::Undo).unwrap(),
        vec![TextEvent::Undone]
    );
    assert_eq!(doc.blocks(), vec!["texto digitado"]);
    doc.execute(TextCommand::Undo).unwrap();
    assert!(doc
        .block_spans(0)
        .unwrap()
        .iter()
        .all(|s| s.marks.is_empty()));
    doc.execute(TextCommand::Undo).unwrap();
    assert_eq!(doc.blocks(), vec!["texto"]);

    // O texto inicial não é desfazível.
    assert!(doc.execute(TextCommand::Undo).unwrap().is_empty());
    assert_eq!(doc.blocks(), vec!["texto"]);

    assert_eq!(
        doc.execute(TextCommand::Redo).unwrap(),
        vec![TextEvent::Redone]
    );
    assert_eq!(doc.blocks(), vec!["texto digitado"]);
}

#[test]
fn salvar_e_carregar_preserva_formatacao() {
    let mut original = TextDocument::from_plain_text(1, "Título\ncorpo");
    original
        .execute(TextCommand::SetBlockStyle {
            block: 0,
            style: BlockStyle::Heading2,
        })
        .unwrap();
    original.execute(apply(1, 0, 5, Mark::Underline)).unwrap();

    let loaded = TextDocument::load(2, &original.save()).unwrap();
    assert_eq!(loaded.blocks(), original.blocks());
    assert_eq!(loaded.block_style(0).unwrap(), BlockStyle::Heading2);
    assert_eq!(
        loaded.block_spans(1).unwrap()[0].marks,
        vec![Mark::Underline]
    );
    assert!(!loaded.can_undo());
}

#[test]
fn edicoes_concorrentes_convergem() {
    let mut a = TextDocument::from_plain_text(1, "Olá mundo");
    let mut b = TextDocument::load(2, &a.save()).unwrap();

    a.execute(insert(0, 0, "A: ")).unwrap();
    b.execute(insert(0, 9, "!")).unwrap();
    b.execute(TextCommand::InsertBlock {
        index: 1,
        text: "nova linha".into(),
        style: BlockStyle::Quote,
    })
    .unwrap();

    sync(&mut a, &mut b);

    assert_eq!(a.to_plain_text(), b.to_plain_text());
    assert_eq!(a.to_plain_text(), "A: Olá mundo!\nnova linha");
    assert_eq!(a.block_style(1).unwrap(), BlockStyle::Quote);
}

#[test]
fn formatacao_concorrente_converge() {
    let mut a = TextDocument::from_plain_text(1, "abcdef");
    let mut b = TextDocument::load(2, &a.save()).unwrap();

    a.execute(apply(0, 0, 4, Mark::Bold)).unwrap();
    b.execute(apply(0, 2, 4, Mark::Italic)).unwrap();
    b.execute(insert(0, 3, "X")).unwrap();

    sync(&mut a, &mut b);

    assert_eq!(a.block_spans(0).unwrap(), b.block_spans(0).unwrap());
    assert_eq!(a.to_plain_text(), "abcXdef");
}

#[test]
fn divisao_concorrente_com_digitacao_converge() {
    let mut a = TextDocument::from_plain_text(1, "abcdef");
    let mut b = TextDocument::load(2, &a.save()).unwrap();

    a.execute(TextCommand::SplitBlock {
        block: 0,
        offset: 3,
    })
    .unwrap();
    b.execute(insert(0, 6, "g")).unwrap();

    sync(&mut a, &mut b);

    assert_eq!(a.blocks(), b.blocks());
}

#[test]
fn desfazer_nao_reverte_o_colega() {
    let mut a = TextDocument::from_plain_text(1, "base");
    let mut b = TextDocument::load(2, &a.save()).unwrap();

    a.execute(insert(0, 4, " de A")).unwrap();
    b.execute(insert(0, 0, "B: ")).unwrap();
    sync(&mut a, &mut b);

    a.execute(TextCommand::Undo).unwrap();
    sync(&mut a, &mut b);
    assert_eq!(a.to_plain_text(), "B: base");
    assert_eq!(b.to_plain_text(), "B: base");
}

#[test]
fn comandos_e_eventos_em_json() {
    let cmd: TextCommand = serde_json::from_str(
        r#"{"type":"text.applyMark","block":0,"offset":2,"len":3,"mark":{"mark":"fontSize","halfPoints":24}}"#,
    )
    .unwrap();
    assert_eq!(cmd, apply(0, 2, 3, Mark::FontSize { half_points: 24 }));

    let cmd: TextCommand = serde_json::from_str(r#"{"type":"history.undo"}"#).unwrap();
    assert_eq!(cmd, TextCommand::Undo);

    let cmd: TextCommand =
        serde_json::from_str(r#"{"type":"block.setStyle","block":1,"style":"heading2"}"#).unwrap();
    assert_eq!(
        cmd,
        TextCommand::SetBlockStyle {
            block: 1,
            style: BlockStyle::Heading2
        }
    );

    let cmd: TextCommand =
        serde_json::from_str(r#"{"type":"text.insert","block":0,"offset":2,"text":"oi"}"#).unwrap();
    assert_eq!(cmd, insert(0, 2, "oi"));

    assert_eq!(
        serde_json::to_string(&TextEvent::BlocksMerged { block: 1, at: 4 }).unwrap(),
        r#"{"type":"blocksMerged","block":1,"at":4}"#
    );
    assert_eq!(
        serde_json::to_string(&TextEvent::Undone).unwrap(),
        r#"{"type":"undone"}"#
    );
}

#[test]
fn atributo_de_paragrafo_em_json() {
    let json = r#"{"type":"block.setAttr","block":0,"attr":"align","value":"center"}"#;
    let command: TextCommand = serde_json::from_str(json).unwrap();
    assert_eq!(
        command,
        TextCommand::SetBlockAttr {
            block: 0,
            attr: ParaAttr::Align(Align::Center)
        }
    );
    assert_eq!(serde_json::to_string(&command).unwrap(), json);

    let clear: TextCommand =
        serde_json::from_str(r#"{"type":"block.setAttr","block":2,"attr":"list","value":null}"#)
            .unwrap();
    assert_eq!(
        clear,
        TextCommand::SetBlockAttr {
            block: 2,
            attr: ParaAttr::List(None)
        }
    );
}

#[test]
fn alinhamento_recuo_espacamento_e_lista() {
    let mut doc = TextDocument::from_plain_text(1, "um\ndois");
    for attr in [
        ParaAttr::Align(Align::Justify),
        ParaAttr::Indent(2),
        ParaAttr::LineSpacing(Some(150)),
        ParaAttr::SpaceAfter(Some(12)),
        ParaAttr::List(Some(ListKind::Number)),
    ] {
        doc.execute(TextCommand::SetBlockAttr { block: 0, attr })
            .unwrap();
    }
    let attrs = doc.block_attrs(0).unwrap();
    assert_eq!(
        attrs,
        ParaAttrs {
            align: Align::Justify,
            indent: 2,
            line_spacing: Some(150),
            space_before: None,
            space_after: Some(12),
            list: Some(ListKind::Number),
            shading: None,
            page_break_before: false,
            cell: None,
            image: None,
            toc: None,
            bibliography: None,
        }
    );
    assert_eq!(doc.block_attrs(1).unwrap(), ParaAttrs::default());

    // Voltar ao padrão remove a chave.
    doc.execute(TextCommand::SetBlockAttr {
        block: 0,
        attr: ParaAttr::Align(Align::Left),
    })
    .unwrap();
    assert_eq!(doc.block_attrs(0).unwrap().align, Align::Left);

    doc.execute(TextCommand::Undo).unwrap();
    assert_eq!(doc.block_attrs(0).unwrap().align, Align::Justify);
}

#[test]
fn atributos_invalidos_sao_recusados() {
    let mut doc = TextDocument::new(1);
    for attr in [
        ParaAttr::Indent(MAX_INDENT + 1),
        ParaAttr::LineSpacing(Some(20)),
        ParaAttr::SpaceBefore(Some(5000)),
    ] {
        let err = doc
            .execute(TextCommand::SetBlockAttr { block: 0, attr })
            .unwrap_err();
        assert!(matches!(err, DomainError::InvalidAttr(_)), "{err:?}");
    }
    assert!(!doc.can_undo());
}

#[test]
fn enter_continua_a_lista_e_item_vazio_sai_dela() {
    let mut doc = TextDocument::from_plain_text(1, "item");
    doc.execute(TextCommand::SetBlockAttr {
        block: 0,
        attr: ParaAttr::List(Some(ListKind::Bullet)),
    })
    .unwrap();
    doc.execute(TextCommand::SetBlockAttr {
        block: 0,
        attr: ParaAttr::Indent(1),
    })
    .unwrap();

    doc.execute(TextCommand::SplitBlock {
        block: 0,
        offset: 4,
    })
    .unwrap();
    assert_eq!(doc.block_count(), 2);
    assert_eq!(doc.block_attrs(1).unwrap(), doc.block_attrs(0).unwrap());

    // Enter no item vazio: primeiro volta um nível, depois sai da lista.
    let events = doc
        .execute(TextCommand::SplitBlock {
            block: 1,
            offset: 0,
        })
        .unwrap();
    assert_eq!(
        events,
        vec![TextEvent::BlockAttrSet {
            block: 1,
            attr: ParaAttr::Indent(0)
        }]
    );
    doc.execute(TextCommand::SplitBlock {
        block: 1,
        offset: 0,
    })
    .unwrap();
    assert_eq!(doc.block_count(), 2);
    assert_eq!(doc.block_attrs(1).unwrap().list, None);
}

#[test]
fn realce_e_sobrescrito() {
    let mut doc = TextDocument::from_plain_text(1, "H2O e x2");
    doc.execute(apply(
        0,
        1,
        1,
        Mark::VertAlign {
            value: "subscript".into(),
        },
    ))
    .unwrap();
    doc.execute(apply(
        0,
        7,
        1,
        Mark::VertAlign {
            value: "superscript".into(),
        },
    ))
    .unwrap();
    doc.execute(apply(
        0,
        0,
        3,
        Mark::Highlight {
            value: "yellow".into(),
        },
    ))
    .unwrap();
    let spans = doc.block_spans(0).unwrap();
    assert!(spans[1].has(MarkKind::VertAlign) && spans[1].has(MarkKind::Highlight));
    assert_eq!(spans[1].text, "2");

    // Sobrescrito no mesmo trecho substitui o subscrito.
    doc.execute(apply(
        0,
        1,
        1,
        Mark::VertAlign {
            value: "superscript".into(),
        },
    ))
    .unwrap();
    let marks = &doc.block_spans(0).unwrap()[1].marks;
    assert!(marks.contains(&Mark::VertAlign {
        value: "superscript".into()
    }));

    for bad in [
        Mark::Highlight {
            value: "#FFFF00".into(),
        },
        Mark::VertAlign {
            value: "baixo".into(),
        },
    ] {
        assert!(matches!(
            doc.execute(apply(0, 0, 1, bad)).unwrap_err(),
            DomainError::InvalidMark(_)
        ));
    }
}

#[test]
fn atributos_de_paragrafo_sincronizam() {
    let mut a = TextDocument::from_plain_text(1, "texto");
    let mut b = TextDocument::load(2, &a.save()).unwrap();
    a.execute(TextCommand::SetBlockAttr {
        block: 0,
        attr: ParaAttr::Align(Align::Center),
    })
    .unwrap();
    b.execute(TextCommand::SetBlockAttr {
        block: 0,
        attr: ParaAttr::List(Some(ListKind::Bullet)),
    })
    .unwrap();
    sync(&mut a, &mut b);
    let expected = ParaAttrs {
        align: Align::Center,
        list: Some(ListKind::Bullet),
        ..ParaAttrs::default()
    };
    assert_eq!(a.block_attrs(0).unwrap(), expected);
    assert_eq!(b.block_attrs(0).unwrap(), expected);
}

#[test]
fn montar_a_partir_de_paragrafos_e_ler_de_volta() {
    let paragraphs = vec![
        Paragraph {
            style: BlockStyle::Heading1,
            attrs: ParaAttrs {
                align: Align::Center,
                ..ParaAttrs::default()
            },
            spans: vec![Span {
                text: "Título".into(),
                marks: vec![],
            }],
        },
        Paragraph {
            style: BlockStyle::Paragraph,
            attrs: ParaAttrs {
                list: Some(ListKind::Number),
                indent: 1,
                line_spacing: Some(150),
                shading: Some("#1F3864".into()),
                ..ParaAttrs::default()
            },
            spans: vec![
                Span {
                    text: "um ".into(),
                    marks: vec![],
                },
                Span {
                    text: "dois\ntrês".into(),
                    marks: vec![Mark::Bold],
                },
            ],
        },
        Paragraph::default(),
    ];
    let doc = TextDocument::from_paragraphs(1, &paragraphs).unwrap();
    assert!(!doc.can_undo(), "a importação não entra no desfazer");
    let back = doc.paragraphs();
    assert_eq!(back.len(), 3);
    assert_eq!(back[0].style, BlockStyle::Heading1);
    assert_eq!(back[0].attrs.align, Align::Center);
    assert_eq!(back[1].attrs, paragraphs[1].attrs);
    assert_eq!(back[1].spans[1].text, "dois\u{b}três");
    assert_eq!(back[1].spans[1].marks, vec![Mark::Bold]);
    assert_eq!(back[2].text(), "");
}

#[test]
fn sombreamento_aceita_so_cor_valida() {
    let mut doc = TextDocument::new(1);
    doc.execute(TextCommand::SetBlockAttr {
        block: 0,
        attr: ParaAttr::Shading(Some("#D9E2F3".into())),
    })
    .unwrap();
    assert_eq!(
        doc.block_attrs(0).unwrap().shading.as_deref(),
        Some("#D9E2F3")
    );
    assert!(doc
        .execute(TextCommand::SetBlockAttr {
            block: 0,
            attr: ParaAttr::Shading(Some("azul".into())),
        })
        .is_err());
    doc.execute(TextCommand::SetBlockAttr {
        block: 0,
        attr: ParaAttr::Shading(None),
    })
    .unwrap();
    assert_eq!(doc.block_attrs(0).unwrap().shading, None);
}

#[test]
fn link_e_quebra_de_pagina() {
    let mut doc = TextDocument::from_plain_text(1, "site\nfim");
    doc.execute(TextCommand::ApplyMark {
        block: 0,
        offset: 0,
        len: 4,
        mark: Mark::Link {
            href: "https://exemplo.com".into(),
        },
    })
    .unwrap();
    assert!(doc
        .execute(TextCommand::ApplyMark {
            block: 0,
            offset: 0,
            len: 4,
            mark: Mark::Link {
                href: "javascript:alert(1)".into(),
            },
        })
        .is_err());
    // Ctrl+Enter: divide e marca o novo parágrafo; Enter depois não leva a quebra adiante.
    doc.execute(TextCommand::Batch {
        commands: vec![
            TextCommand::SplitBlock {
                block: 0,
                offset: 4,
            },
            TextCommand::SetBlockAttr {
                block: 1,
                attr: ParaAttr::PageBreakBefore(true),
            },
        ],
    })
    .unwrap();
    doc.execute(TextCommand::SplitBlock {
        block: 1,
        offset: 0,
    })
    .unwrap();
    let flags: Vec<bool> = (0..doc.block_count())
        .map(|b| doc.block_attrs(b).unwrap().page_break_before)
        .collect();
    assert_eq!(flags, [false, true, false, false]);
    assert_eq!(
        doc.paragraphs()[0].spans[0].marks,
        vec![Mark::Link {
            href: "https://exemplo.com".into()
        }]
    );
}

#[test]
fn digitar_depois_do_link_nao_estende_o_link() {
    let mut doc = TextDocument::from_plain_text(1, "site");
    let link = Mark::Link {
        href: "https://exemplo.com".into(),
    };
    doc.execute(TextCommand::ApplyMark {
        block: 0,
        offset: 0,
        len: 4,
        mark: link.clone(),
    })
    .unwrap();
    for (offset, text) in [(4, " fim"), (2, "XX")] {
        doc.execute(TextCommand::InsertText {
            block: 0,
            offset,
            text: text.into(),
            marks: None,
        })
        .unwrap();
    }
    let spans = doc.block_spans(0).unwrap();
    assert_eq!(spans[0].text, "siXXte");
    assert_eq!(spans[0].marks, vec![link]);
    assert_eq!((spans[1].text.as_str(), spans[1].marks.len()), (" fim", 0));
}

#[test]
fn celulas_de_tabela() {
    let mut doc = TextDocument::from_plain_text(1, "a\nb");
    let cell = |row, col| CellRef {
        table: "t1".into(),
        row,
        col,
    };
    for (block, c) in [(0, cell(0, 0)), (1, cell(0, 1))] {
        doc.execute(TextCommand::SetBlockAttr {
            block,
            attr: ParaAttr::Cell(Some(c)),
        })
        .unwrap();
    }
    // Enter dentro da célula cria outro parágrafo na mesma célula.
    doc.execute(TextCommand::SplitBlock {
        block: 0,
        offset: 1,
    })
    .unwrap();
    let cells: Vec<Option<CellRef>> = (0..3).map(|b| doc.block_attrs(b).unwrap().cell).collect();
    assert_eq!(
        cells,
        [Some(cell(0, 0)), Some(cell(0, 0)), Some(cell(0, 1))]
    );
    assert!(doc
        .execute(TextCommand::SetBlockAttr {
            block: 0,
            attr: ParaAttr::Cell(Some(CellRef {
                table: "com espaço".into(),
                row: 0,
                col: 0
            })),
        })
        .is_err());
    // O JSON que a interface manda.
    let json = r#"{"type":"block.setAttr","block":2,"attr":"cell","value":{"table":"t-2","row":3,"col":1}}"#;
    doc.execute(serde_json::from_str(json).unwrap()).unwrap();
    assert_eq!(doc.block_attrs(2).unwrap().cell.unwrap().table, "t-2");
}

#[test]
fn imagens() {
    let mut doc = TextDocument::new(1);
    doc.put_media("f00", "image/png", &[137, 80, 78, 71])
        .unwrap();
    assert!(
        doc.put_media("F00", "image/png", &[1]).is_err(),
        "id em minúsculas"
    );
    assert!(
        doc.put_media("a1", "text/html", &[1]).is_err(),
        "só imagens"
    );
    let image = ImageRef {
        id: "f00".into(),
        width: 200,
        height: 100,
    };
    doc.execute(TextCommand::SetBlockAttr {
        block: 0,
        attr: ParaAttr::Image(Some(image.clone())),
    })
    .unwrap();
    // Enter na imagem cria um parágrafo comum depois dela.
    doc.execute(TextCommand::SplitBlock {
        block: 0,
        offset: 0,
    })
    .unwrap();
    assert_eq!(doc.block_attrs(0).unwrap().image, Some(image));
    assert_eq!(doc.block_attrs(1).unwrap().image, None);
    assert_eq!(doc.media("f00").unwrap().0, "image/png");
    // O arquivo vai junto no estado do documento.
    let copy = TextDocument::load(2, &doc.save()).unwrap();
    assert_eq!(copy.media("f00").unwrap().1, vec![137, 80, 78, 71]);
}

#[test]
fn pagina_e_margens() {
    let mut doc = TextDocument::new(1);
    assert_eq!(doc.page_setup(), PageSetup::default());
    let landscape = PageSetup {
        width: 16838,
        height: 11906,
        ..PageSetup::default()
    };
    doc.execute(TextCommand::SetPage {
        page: landscape.clone(),
    })
    .unwrap();
    assert_eq!(doc.page_setup(), landscape);
    let bad = PageSetup {
        margin_left: 9000,
        margin_right: 9000,
        ..PageSetup::default()
    };
    assert!(doc.execute(TextCommand::SetPage { page: bad }).is_err());
    doc.execute(TextCommand::Undo).unwrap();
    assert_eq!(doc.page_setup(), PageSetup::default());
    let json = r#"{"type":"page.set","page":{"width":12240,"height":15840,"marginTop":1440,"marginBottom":1440,"marginLeft":1440,"marginRight":1440}}"#;
    doc.execute(serde_json::from_str(json).unwrap()).unwrap();
    assert_eq!(doc.page_setup().width, 12240);
}

#[test]
fn cabecalho_e_rodape() {
    let mut doc = TextDocument::new(1);
    assert_eq!(doc.header_footer(), HeadersFooters::default());
    let value = HeadersFooters {
        header: HeaderFooter {
            text: "Relatório final".into(),
            align: Align::Center,
        },
        footer: HeaderFooter {
            text: "Página {PAGE} de {NUMPAGES}".into(),
            align: Align::Right,
        },
        different_first: true,
    };
    doc.execute(TextCommand::SetHeaderFooter {
        value: value.clone(),
    })
    .unwrap();
    assert_eq!(doc.header_footer(), value);
    doc.execute(TextCommand::Undo).unwrap();
    assert_eq!(doc.header_footer(), HeadersFooters::default());
    let json = r#"{"type":"headerFooter.set","value":{"header":{"text":"{PAGE}","align":"right"},"footer":{"text":"","align":"left"},"differentFirst":false}}"#;
    doc.execute(serde_json::from_str(json).unwrap()).unwrap();
    assert_eq!(doc.header_footer().header.text, "{PAGE}");
    let bad = HeadersFooters {
        header: HeaderFooter {
            text: "duas\nlinhas".into(),
            align: Align::Left,
        },
        ..HeadersFooters::default()
    };
    assert!(doc
        .execute(TextCommand::SetHeaderFooter { value: bad })
        .is_err());
}

#[test]
fn sumario_vai_ao_crdt_e_volta() {
    use crate::format::TocEntry;
    let mut doc = TextDocument::from_plain_text(1, "Sumário\nIntrodução");
    let entry = TocEntry { level: 2, page: 14 };
    doc.execute(TextCommand::SetBlockAttr {
        block: 1,
        attr: ParaAttr::Toc(Some(entry)),
    })
    .unwrap();
    assert_eq!(doc.block_attrs(1).unwrap().toc, Some(entry));
    // Nível acima de 6 é recusado.
    assert!(doc
        .execute(TextCommand::SetBlockAttr {
            block: 0,
            attr: ParaAttr::Toc(Some(TocEntry { level: 7, page: 1 })),
        })
        .is_err());
    // No JSON da interface.
    let json = serde_json::to_value(doc.block_attrs(1).unwrap()).unwrap();
    assert_eq!(json["toc"], serde_json::json!({"level": 2, "page": 14}));
    doc.execute(TextCommand::Undo).unwrap();
    assert_eq!(doc.block_attrs(1).unwrap().toc, None);
}

#[test]
fn nota_de_rodape_no_texto_e_nas_configuracoes() {
    use crate::format::FOOTNOTE_CHAR;
    let mut doc = TextDocument::from_plain_text(1, "Texto");
    doc.execute(TextCommand::Batch {
        commands: vec![
            TextCommand::InsertText {
                block: 0,
                offset: 5,
                text: FOOTNOTE_CHAR.to_string(),
                marks: Some(vec![Mark::Footnote { id: "x1".into() }]),
            },
            TextCommand::SetFootnote {
                id: "x1".into(),
                text: Some("Nota".into()),
            },
        ],
    })
    .unwrap();
    assert_eq!(
        doc.footnotes(),
        vec![("x1".to_string(), "Nota".to_string())]
    );
    // Digitar logo depois da chamada não estende a nota.
    doc.execute(TextCommand::InsertText {
        block: 0,
        offset: 6,
        text: " depois".into(),
        marks: None,
    })
    .unwrap();
    let spans = doc.block_spans(0).unwrap();
    assert_eq!(spans.last().unwrap().text, " depois");
    assert!(spans.last().unwrap().marks.is_empty());
    // Id inválido e nota com quebra de parágrafo são recusados.
    assert!(doc
        .execute(TextCommand::SetFootnote {
            id: "a b".into(),
            text: Some("x".into())
        })
        .is_err());
    assert!(doc
        .execute(TextCommand::SetFootnote {
            id: "x1".into(),
            text: Some("a\nb".into())
        })
        .is_err());
    // Apagar a chamada tira a nota da lista; desfazer a traz de volta.
    doc.execute(TextCommand::DeleteText {
        block: 0,
        offset: 5,
        len: 1,
    })
    .unwrap();
    assert!(doc.footnotes().is_empty());
    doc.execute(TextCommand::Undo).unwrap();
    assert_eq!(doc.footnotes().len(), 1);
}

#[test]
fn comentario_no_texto_e_nas_configuracoes() {
    use crate::Comment;
    let c = |text: &str, parent: Option<&str>| Comment {
        author: "Ana".into(),
        initials: "A".into(),
        date: "2026-10-30T10:00:00Z".into(),
        text: text.into(),
        done: false,
        parent: parent.map(Into::into),
    };
    let mut doc = TextDocument::from_plain_text(1, "Texto comentado");
    doc.execute(TextCommand::Batch {
        commands: vec![
            TextCommand::ApplyMark {
                block: 0,
                offset: 6,
                len: 9,
                mark: Mark::Comment { id: "k".into() },
            },
            TextCommand::SetComment {
                id: "k".into(),
                value: Some(c("Revisar", None)),
            },
            TextCommand::SetComment {
                id: "r".into(),
                value: Some(c("Feito", Some("k"))),
            },
        ],
    })
    .unwrap();
    let ids: Vec<String> = doc.comments().into_iter().map(|(id, _)| id).collect();
    assert_eq!(ids, ["k", "r"]);
    // Digitar logo depois do trecho não estende o comentário; dentro dele, sim.
    doc.execute(TextCommand::InsertText {
        block: 0,
        offset: 15,
        text: " depois".into(),
        marks: None,
    })
    .unwrap();
    doc.execute(TextCommand::InsertText {
        block: 0,
        offset: 8,
        text: "X".into(),
        marks: None,
    })
    .unwrap();
    let spans = doc.block_spans(0).unwrap();
    let marked: String = spans
        .iter()
        .filter(|s| !s.marks.is_empty())
        .map(|s| s.text.as_str())
        .collect();
    assert_eq!(marked, "coXmentado");
    // Inválidos: autor vazio, quebra de parágrafo, resposta a si mesmo, data estranha.
    for bad in [
        Comment {
            author: " ".into(),
            ..c("x", None)
        },
        c("a\nb", None),
        c("x", Some("z")),
        Comment {
            date: "ontem".into(),
            ..c("x", None)
        },
    ] {
        assert!(doc
            .execute(TextCommand::SetComment {
                id: "z".into(),
                value: Some(bad)
            })
            .is_err());
    }
    // Apagar e desfazer.
    doc.execute(TextCommand::SetComment {
        id: "r".into(),
        value: None,
    })
    .unwrap();
    assert_eq!(doc.comments().len(), 1);
    doc.execute(TextCommand::Undo).unwrap();
    assert_eq!(doc.comments().len(), 2);
    assert_eq!(Comment::initials_of("ana maria souza lima"), "AMS");
}

#[test]
fn fonte_e_citacao_no_texto() {
    use crate::{citation_text, Person, Source, SourceKind, CITATION_CHAR};
    let livro = Source {
        kind: SourceKind::Book,
        authors: vec![Person {
            last: "Silva".into(),
            first: "João".into(),
        }],
        title: "Metodologia científica: um guia".into(),
        year: "2026".into(),
        publisher: "Atlas".into(),
        place: "São Paulo".into(),
        ..Default::default()
    };
    let mut doc = TextDocument::from_plain_text(1, "Segundo o autor.");
    let cite = |page: Option<&str>| Mark::Citation {
        id: "s1".into(),
        page: page.map(Into::into),
    };
    doc.execute(TextCommand::Batch {
        commands: vec![
            TextCommand::SetSource {
                id: "s1".into(),
                value: Some(Box::new(livro.clone())),
            },
            TextCommand::InsertText {
                block: 0,
                offset: 15,
                text: format!(" {CITATION_CHAR}"),
                marks: Some(vec![cite(Some("12"))]),
            },
        ],
    })
    .unwrap();
    // A marca só fica no caractere da chamada inteiro: " X" com espaço perde a marca.
    assert!(doc.citations().is_empty());
    doc.execute(TextCommand::InsertText {
        block: 0,
        offset: 16,
        text: CITATION_CHAR.to_string(),
        marks: Some(vec![cite(Some("12"))]),
    })
    .unwrap();
    assert_eq!(
        doc.citations(),
        [("s1".to_string(), Some("12".to_string()))]
    );
    // Digitar logo depois da chamada não vira citação.
    doc.execute(insert(0, 17, "x")).unwrap();
    assert_eq!(doc.citations().len(), 1);
    assert_eq!(doc.sources()["s1"], livro);
    let s = doc.sources();
    assert_eq!(
        citation_text(s.get("s1"), Some("12")),
        "(SILVA, 2026, p. 12)"
    );
    assert_eq!(citation_text(None, None), "(?)");
    // Vários autores, et al. e sem autor.
    let p = |l: &str| Person {
        last: l.into(),
        first: String::new(),
    };
    let dois = Source {
        authors: vec![p("Silva"), p("Souza")],
        ..livro.clone()
    };
    assert_eq!(citation_text(Some(&dois), None), "(SILVA; SOUZA, 2026)");
    let quatro = Source {
        authors: vec![p("Lima"), p("b"), p("c"), p("d")],
        year: String::new(),
        ..livro.clone()
    };
    assert_eq!(citation_text(Some(&quatro), None), "(LIMA et al., [s. d.])");
    let anonimo = Source {
        authors: vec![],
        ..livro.clone()
    };
    assert_eq!(
        citation_text(Some(&anonimo), None),
        "(METODOLOGIA..., 2026)"
    );
    // Inválidas: sem título nem autor, data de acesso fora do ISO, página com quebra.
    for bad in [
        Source::default(),
        Source {
            accessed: "30/10/2026".into(),
            ..livro.clone()
        },
    ] {
        assert!(doc
            .execute(TextCommand::SetSource {
                id: "z".into(),
                value: Some(Box::new(bad))
            })
            .is_err());
    }
    assert!(doc
        .execute(TextCommand::ApplyMark {
            block: 0,
            offset: 0,
            len: 1,
            mark: Mark::Citation {
                id: "s1".into(),
                page: Some("a\nb".into()),
            },
        })
        .is_err());
    // Apagar e desfazer.
    doc.execute(TextCommand::SetSource {
        id: "s1".into(),
        value: None,
    })
    .unwrap();
    assert!(doc.sources().is_empty());
    doc.execute(TextCommand::Undo).unwrap();
    assert_eq!(doc.sources().len(), 1);
    // A fonte vai e volta pelo estado (coedição, .nova).
    let back = TextDocument::load(2, &doc.save()).unwrap();
    assert_eq!(back.sources(), doc.sources());
    assert_eq!(back.citations(), doc.citations());
}

#[test]
fn paragrafo_da_bibliografia() {
    use crate::BibPart;
    let mut doc = TextDocument::from_plain_text(1, "REFERÊNCIAS\nSILVA, João.");
    doc.execute(TextCommand::SetBlockAttr {
        block: 1,
        attr: ParaAttr::Bibliography(Some(BibPart::Entry)),
    })
    .unwrap();
    assert_eq!(
        doc.block_attrs(1).unwrap().bibliography,
        Some(BibPart::Entry)
    );
    let json = serde_json::to_string(&TextCommand::SetBlockAttr {
        block: 0,
        attr: ParaAttr::Bibliography(Some(BibPart::Title)),
    })
    .unwrap();
    assert_eq!(
        json,
        r#"{"type":"block.setAttr","block":0,"attr":"bibliography","value":"title"}"#
    );
    let back = TextDocument::from_paragraphs(2, &doc.paragraphs()).unwrap();
    assert_eq!(back.paragraphs(), doc.paragraphs());
}
