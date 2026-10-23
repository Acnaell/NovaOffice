"""Experimento: o Rclone como motor do Nova Drive, controlado só pela API (rcd).

Uso: RCLONE=/caminho/do/rclone python3 scripts/experimentos/rclone_api.py

Sobe uma "nuvem" simulada (servidor WebDAV no modo ownCloud, servido pelo próprio
rclone) e o motor (rclone rcd). Depois faz pela API o que o Nova Drive faria:
conta, listagem, download com progresso, cancelamento, envio, pasta sincronizada
(bisync), conflito, unidade montada (precisa de FUSE/WinFsp) e o começo do
assistente de conta do Google Drive. Resultados em docs/nova-drive/VISAO.md.
"""
import base64
import filecmp
import json
import os
import shutil
import tempfile
import subprocess
import sys
import time
import urllib.request

R = os.environ.get("RCLONE") or shutil.which("rclone") or sys.exit("defina RCLONE com o caminho do rclone")
T = tempfile.mkdtemp(prefix="nova-drive-")
for d in ("cloud/Documentos", "local", "cache", "sync", "mnt"):
    os.makedirs(os.path.join(T, d))
open(os.path.join(T, "cloud/Documentos/relatorio.txt"), "w").write("relatório na nuvem\n")
with open(os.path.join(T, "cloud/Documentos/video.bin"), "wb") as f:
    f.write(os.urandom(60 * 1024 * 1024))

procs = []
def start(*args):
    p = subprocess.Popen([R, *args], stdout=subprocess.DEVNULL, stderr=open(os.path.join(T, f"log-{len(procs)}.txt"), "w"))
    procs.append(p)

# "Nuvem" simulada: um servidor WebDAV (o mesmo protocolo do Nextcloud), mais lento de propósito.
start("serve", "webdav", os.path.join(T, "cloud"), "--addr", "127.0.0.1:8090", "--user", "ana", "--pass", "segredo", "--dir-cache-time", "0s")
# Motor do Nova Drive.
start("rcd", "--rc-addr", "127.0.0.1:5572", "--rc-user", "nova", "--rc-pass", "teste",
      "--config", os.path.join(T, "rclone.conf"), "--cache-dir", os.path.join(T, "cache"), "--bwlimit", "40M")
AUTH = "Basic " + base64.b64encode(b"nova:teste").decode()

def rc(cmd, **params):
    req = urllib.request.Request("http://127.0.0.1:5572/" + cmd, data=json.dumps(params).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": AUTH})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return {"HTTP": e.code, **json.loads(e.read() or b"{}")}

for _ in range(50):
    try:
        rc("core/version"); break
    except Exception:
        time.sleep(0.2)

def step(title):
    print(f"\n== {title}")

try:
    step("versão"); print(rc("core/version")["version"])

    step("adicionar conta (WebDAV simulando a nuvem)")
    print(rc("config/create", name="nuvem", type="webdav",
             parameters={"url": "http://127.0.0.1:8090", "vendor": "owncloud", "user": "ana", "pass": "segredo"},
             opt={"obscure": True, "nonInteractive": True}))
    print("contas:", rc("config/listremotes")["remotes"])
    conf = open(os.path.join(T, "rclone.conf")).read()
    print("senha guardada em texto puro?", "segredo" in conf)
    fi = rc("operations/fsinfo", fs="nuvem:")
    print("fsinfo:", {k: fi.get(k) for k in ("Precision", "Hashes", "HTTP", "error")})

    step("listar pasta")
    for i in rc("operations/list", fs="nuvem:", remote="Documentos")["list"]:
        print(f"  {i['Name']:<16} {i['Size']:>10}  {i['MimeType']}")

    step("baixar arquivo grande em segundo plano, com progresso")
    job = rc("operations/copyfile", srcFs="nuvem:Documentos", srcRemote="video.bin",
             dstFs=os.path.join(T, "local"), dstRemote="video.bin", _async=True, _group="baixar")["jobid"]
    while True:
        st = rc("job/status", jobid=job)
        stats = rc("core/stats", group="baixar")
        tr = [(x["name"], x.get("percentage")) for x in stats.get("transferring") or []]
        print(f"  {stats['bytes'] / 1e6:6.1f} MB  {stats['speed'] / 1e6:5.1f} MB/s  {tr}")
        if st["finished"]:
            print("  terminou:", st["success"], st["error"] or "")
            break
        time.sleep(0.4)
    print("  conteúdo idêntico:", filecmp.cmp(os.path.join(T, "cloud/Documentos/video.bin"), os.path.join(T, "local/video.bin"), shallow=False))

    step("cancelar uma transferência no meio")
    job = rc("operations/copyfile", srcFs="nuvem:Documentos", srcRemote="video.bin",
             dstFs=os.path.join(T, "local"), dstRemote="copia.bin", _async=True, _group="cancelar")["jobid"]
    time.sleep(0.5)
    print(" ", rc("job/stop", jobid=job))
    time.sleep(0.5)
    st = rc("job/status", jobid=job)
    print("  status:", st["finished"], st["success"], st["error"][:60])
    print("  arquivo parcial ficou?", os.path.exists(os.path.join(T, "local/copia.bin")))

    step("enviar arquivo novo")
    open(os.path.join(T, "local/notas.txt"), "w").write("rascunho local\n")
    print(rc("operations/copyfile", srcFs=os.path.join(T, "local"), srcRemote="notas.txt", dstFs="nuvem:Documentos", dstRemote="notas.txt"))
    print("  na nuvem:", sorted(os.listdir(os.path.join(T, "cloud/Documentos"))))

    step("pasta sincronizada (bisync): primeira vez")
    os.remove(os.path.join(T, "cloud/Documentos/video.bin"))
    r = rc("sync/bisync", path1=os.path.join(T, "sync"), path2="nuvem:Documentos", resync=True, workdir=os.path.join(T, "bisync"))
    print(" ", r or "ok", "| PC:", sorted(os.listdir(os.path.join(T, "sync"))))

    step("mudanças dos dois lados e nova sincronização")
    time.sleep(1.1)
    open(os.path.join(T, "sync/notas.txt"), "w").write("editado no PC\n")
    open(os.path.join(T, "cloud/Documentos/da-nuvem.txt"), "w").write("criado na nuvem\n")
    os.remove(os.path.join(T, "cloud/Documentos/relatorio.txt"))
    r = rc("sync/bisync", path1=os.path.join(T, "sync"), path2="nuvem:Documentos", workdir=os.path.join(T, "bisync"), maxDelete=100)
    print(" ", r or "ok")
    print("  PC:   ", sorted(os.listdir(os.path.join(T, "sync"))))
    print("  Nuvem:", sorted(os.listdir(os.path.join(T, "cloud/Documentos"))))
    print("  notas.txt na nuvem:", open(os.path.join(T, "cloud/Documentos/notas.txt")).read().strip())

    step("conflito: o mesmo arquivo editado nos dois lados")
    time.sleep(1.1)
    open(os.path.join(T, "sync/notas.txt"), "w").write("versão do PC\n")
    open(os.path.join(T, "cloud/Documentos/notas.txt"), "w").write("versão da nuvem\n")
    r = rc("sync/bisync", path1=os.path.join(T, "sync"), path2="nuvem:Documentos", workdir=os.path.join(T, "bisync"), maxDelete=100)
    print(" ", r or "ok")
    print("  PC:   ", sorted(os.listdir(os.path.join(T, "sync"))))

    step("unidade montada (VFS com cache), como uma letra de unidade no Windows")
    r = rc("mount/mount", fs="nuvem:", mountPoint=os.path.join(T, "mnt"), vfsOpt={"CacheMode": "full"})
    print(" ", r or "ok")
    time.sleep(1.5)
    try:
        print("  arquivos vistos pelo sistema:", sorted(os.listdir(os.path.join(T, "mnt/Documentos"))))
        open(os.path.join(T, "mnt/Documentos/pelo-explorer.txt"), "w").write("salvo pela unidade\n")
        time.sleep(6)
        print("  chegou na nuvem?", os.path.exists(os.path.join(T, "cloud/Documentos/pelo-explorer.txt")))
    except Exception as e:
        print("  montagem indisponível aqui:", e)
    print(" ", rc("mount/unmountall") or "desmontado")

    step("Google Drive: o assistente de conta é controlável pela API?")
    r = rc("config/create", name="gdrive", type="drive", parameters={}, opt={"nonInteractive": True})
    print("  pergunta:", (r.get("Option") or {}).get("Name"), "|", ((r.get("Option") or {}).get("Help") or "")[:120].replace("\n", " "))
    print("  estado:", r.get("State", "")[:40], "| erro:", r.get("Error"))
finally:
    for p in procs:
        p.terminate()
    for p in procs:
        p.wait(timeout=10)
    shutil.rmtree(T, ignore_errors=True)
