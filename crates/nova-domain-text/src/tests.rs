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
