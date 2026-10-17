# GSICM on pocker

Dashboard: http://192.168.50.51:3210

Installed in `/home/server/gsicm` from ZL1LAC/gsicm. Node 24 is installed under `/home/server/.local/opt`. Sanchez was built from nullpainter/sanchez for Linux ARM64, including its resources, into `bin/`. Python satellite decoders use `.venv-gk2a`.

The dashboard requires the generated password stored in `.server.env`. Show it in your own terminal:

```bash
sed -n 's/^GSICM_PASSWORD=//p' /home/server/gsicm/.server.env
```

Enable startup at boot and operation after logout:

```bash
sudo loginctl enable-linger server
```

Service commands (run as server):

```bash
systemctl --user status gsicm
systemctl --user restart gsicm
systemctl --user stop gsicm
```

The listener is bound to the LAN address. Nginx Proxy Manager can forward HTTP to `192.168.50.51:3210`. No domain or router forwarding was configured by this installation.

Back up `data/` and `.server.env` to preserve settings, imagery and login configuration. The source entries initially need configuration and operator verification before live satellite processing; installation checks use synthetic imagery.
