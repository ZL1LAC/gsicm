import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import selfsigned from "selfsigned";
import { discover, download, anonymousS3 } from "../server/acquisition.js";
import { sourceSchema, settingsSchema } from "../shared/types.js";
const settings = settingsSchema.parse({ downloadTimeoutSeconds: 3 });
const base = sourceSchema.parse({
  id: "test",
  name: "test",
  satellite: "test",
  region: "test",
  enabled: true,
  transport: "ftp",
  location: "ftp://127.0.0.1/",
  longitude: 0,
  attribution: "fixture",
});
async function ftpFixture(secure = false) {
  const cert = secure
    ? await selfsigned.generate([{ name: "commonName", value: "localhost" }], {
        keySize: 2048,
        extensions: [
          {
            name: "subjectAltName",
            altNames: [
              { type: 7, ip: "127.0.0.1" },
              { type: 2, value: "localhost" },
            ],
          },
        ],
      })
    : undefined;
  const context = cert
    ? tls.createSecureContext({ key: cert.private, cert: cert.cert })
    : undefined;
  const sockets = new Set<net.Socket>();
  const passive = new Set<net.Server>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let channel: net.Socket = socket,
      buffer = "",
      dataSocket: net.Socket | undefined,
      waitData: ((s: net.Socket) => void) | undefined;
    const reply = (value: string) => channel.write(value + "\r\n");
    const send = async (content: Buffer) => {
      reply("150 Opening data connection");
      const s =
        dataSocket ?? (await new Promise<net.Socket>((r) => (waitData = r)));
      dataSocket = undefined;
      await new Promise<void>((r) => s.end(content, r));
      reply("226 Transfer complete");
    };
    const handler = (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const [command, ...parts] = line.split(" ");
        const arg = parts.join(" ");
        void (async () => {
          switch (command) {
            case "AUTH":
              reply("234 TLS accepted");
              channel.removeListener("data", handler);
              channel = new tls.TLSSocket(socket, {
                isServer: true,
                secureContext: context,
              });
              channel.on("error", () => {});
              channel.on("data", handler);
              break;
            case "USER":
              reply("331 Password");
              break;
            case "PASS":
              reply("230 Logged in");
              break;
            case "FEAT":
              reply("211-Features\r\n EPSV\r\n MLSD\r\n211 End");
              break;
            case "PWD":
              reply('257 "/"');
              break;
            case "TYPE":
            case "OPTS":
            case "PBSZ":
            case "PROT":
            case "CWD":
              reply("200 OK");
              break;
            case "EPSV": {
              const accept = (s: net.Socket) => {
                sockets.add(s);
                s.on("error", () => {});
                s.on("close", () => sockets.delete(s));
                if (waitData) {
                  const r = waitData;
                  waitData = undefined;
                  r(s);
                } else dataSocket = s;
              };
              const data = secure
                ? tls.createServer(
                    { key: cert!.private, cert: cert!.cert },
                    accept,
                  )
                : net.createServer(accept);
              passive.add(data);
              data.on("error", () => {});
              await new Promise<void>((r) => data.listen(0, "127.0.0.1", r));
              reply(
                `229 Entering Extended Passive Mode (|||${(data.address() as net.AddressInfo).port}|)`,
              );
              break;
            }
            case "MLSD":
            case "LIST":
              await send(
                Buffer.from(
                  "type=file;size=7;modify=20200101120000; IR_20200101T120000Z.png\r\n",
                ),
              );
              break;
            case "RETR":
              if (arg.includes("missing")) reply("550 Not found");
              else await send(Buffer.from("fixture"));
              break;
            case "QUIT":
              reply("221 Bye");
              channel.end();
              break;
            default:
              reply("200 OK");
          }
        })().catch(() => socket.destroy());
      }
    };
    socket.on("data", handler);
    reply("220 Fixture FTP");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as net.AddressInfo).port,
    cert: cert?.cert,
    close: async () => {
      for (const s of sockets) s.destroy();
      for (const s of passive) s.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
test("FTP directory discovery and download; missing transfer terminates cleanly", async () => {
  const fixture = await ftpFixture(),
    dir = await mkdtemp(path.join(os.tmpdir(), "gsicm-ftp-"));
  const s = { ...base, location: `ftp://127.0.0.1:${fixture.port}/` };
  try {
    const found = await discover(
      s,
      new Date("2020-01-01T12:00:00Z"),
      30,
      settings,
      AbortSignal.timeout(5000),
    );
    assert.equal(found.length, 1);
    await download(
      s,
      found[0],
      path.join(dir, "file"),
      settings,
      AbortSignal.timeout(5000),
    );
    assert.equal(await readFile(path.join(dir, "file"), "utf8"), "fixture");
    await assert.rejects(
      download(
        s,
        { ...found[0], url: "/missing.png" },
        path.join(dir, "bad"),
        settings,
        AbortSignal.timeout(5000),
      ),
    );
  } finally {
    await fixture.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("FTPS certificate verification and encrypted listing/download", async () => {
  const fixture = await ftpFixture(true),
    dir = await mkdtemp(path.join(os.tmpdir(), "gsicm-ftps-"));
  const s = {
    ...base,
    transport: "ftps" as const,
    location: `ftps://127.0.0.1:${fixture.port}/`,
  };
  try {
    await assert.rejects(
      discover(
        s,
        new Date("2020-01-01T12:00:00Z"),
        30,
        settings,
        AbortSignal.timeout(5000),
      ),
    );
    const ca = path.join(dir, "ca.pem");
    await writeFile(ca, fixture.cert!);
    const script = `import {discover,download} from './server/acquisition.ts'; const s=${JSON.stringify(s)};const settings=${JSON.stringify(settings)};const signal=AbortSignal.timeout(10000);const found=await discover(s,new Date('2020-01-01T12:00:00Z'),30,settings,signal);if(found.length!==1)throw new Error('listing');await download(s,found[0],${JSON.stringify(path.join(dir, "encrypted"))},settings,signal);`;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        { env: { ...process.env, NODE_EXTRA_CA_CERTS: ca }, windowsHide: true },
      );
      let logs = "";
      child.stderr.on("data", (c) => (logs += c));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(logs)),
      );
    });
    assert.equal(
      await readFile(path.join(dir, "encrypted"), "utf8"),
      "fixture",
    );
  } finally {
    await fixture.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("anonymous S3 listing is unsigned, paginated, timestamp-filtered and cancellable", async () => {
  let calls = 0;
  const s = {
    ...base,
    transport: "s3" as const,
    bucket: "fixture-bucket",
    prefix: "data/{YYYY}/",
  };
  const factory = () =>
    anonymousS3({
      requestHandler: {
        handle: async (request: {
          headers: Record<string, string>;
          query: Record<string, string>;
        }) => {
          assert.equal(request.headers.authorization, undefined);
          calls++;
          const second = !!request.query["continuation-token"];
          const key = second
            ? "data/2020/IR_20200101T115000Z.png"
            : "data/2020/IR_20200101T120000Z.png";
          const xml = `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>${!second}</IsTruncated>${!second ? "<NextContinuationToken>page2</NextContinuationToken>" : ""}<Contents><Key>${key}</Key><Size>7</Size></Contents></ListBucketResult>`;
          return {
            response: {
              statusCode: 200,
              headers: { "content-type": "application/xml" },
              body: Readable.from([xml]),
            },
          };
        },
      },
    });
  const found = await discover(
    s,
    new Date("2020-01-01T12:00:00Z"),
    30,
    settings,
    new AbortController().signal,
    factory,
  );
  assert.equal(calls, 2);
  assert.equal(found.length, 2);
  const dotted = await discover(
    { ...s, bucket: "fixture.bucket" },
    new Date("2020-01-01T12:00:00Z"),
    30,
    settings,
    new AbortController().signal,
    factory,
  );
  assert.match(
    dotted[0].url,
    /https:\/\/s3\.us-east-1\.amazonaws\.com\/fixture\.bucket\//,
  );
  assert.match(found[0].url, /fixture-bucket\.s3\.us-east-1\.amazonaws\.com/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    discover(
      s,
      new Date("2020-01-01T12:00:00Z"),
      30,
      settings,
      controller.signal,
    ),
  );
});
