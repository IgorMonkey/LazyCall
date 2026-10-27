const { createReadStream } = require("node:fs");
const { readFile, stat } = require("node:fs/promises");
const { createServer } = require("node:http");
const path = require("node:path");

const project = path.resolve(__dirname, "..");
const output = path.join(project, "release", "lazycall-web-preview");
const manifestPath = path.join(output, "web-installer-manifest.json");
const port = 38473;

function parseArguments(values) {
  let throttleMbps = 20, badPayload = false;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--bad-payload") badPayload = true;
    else if (values[index] === "--throttle-mbps" && values[index + 1]) {
      throttleMbps = Number(values[++index]);
      if (!Number.isFinite(throttleMbps) || throttleMbps <= 0 || throttleMbps > 1000) throw new Error("Throttle must be between 0 and 1000 MB/s");
    } else throw new Error("Usage: node scripts/serve-web-preview.cjs [--throttle-mbps <MB/s>] [--bad-payload]");
  }
  return { throttleMbps, badPayload };
}

function log(event, details = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...details }));
}

(async () => {
  const options = parseArguments(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.mode !== "local-preview" || !/^[A-Za-z0-9_.-]+$/.test(manifest.payload?.name || "")) throw new Error("Preview manifest is invalid");
  const payload = path.join(output, "nsis-web", manifest.payload.name);
  if (path.relative(output, payload).startsWith("..")) throw new Error("Preview payload must stay in its output folder");
  const payloadStat = await stat(payload);
  if (payloadStat.size !== manifest.payload.bytes) throw new Error("Preview payload size differs from its manifest");
  const endpoint = "/" + manifest.payload.name;
  const bytesPerSecond = Math.floor(options.throttleMbps * 1024 * 1024);
  let corruptNextCompleteDownload = options.badPayload;

  createServer((request, response) => {
    if (request.method !== "GET" || request.url !== endpoint) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      log("rejected", { method: request.method, path: request.url });
      return;
    }
    let start = 0, end = payloadStat.size - 1, statusCode = 200;
    const range = request.headers.range;
    const match = typeof range === "string" && /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), end);
      if (start > end || start >= payloadStat.size) {
        response.writeHead(416, { "Content-Range": "bytes */" + payloadStat.size });
        response.end();
        return;
      }
      statusCode = 206;
    }
    const length = end - start + 1;
    response.writeHead(statusCode, {
      "Accept-Ranges": "bytes",
      "Content-Length": length,
      "Content-Type": "application/octet-stream",
      ...(statusCode === 206 ? { "Content-Range": "bytes " + start + "-" + end + "/" + payloadStat.size } : {}),
    });
    const corruptThisDownload = corruptNextCompleteDownload && start === 0;
    log("download", { bytes: length, range: range || null, corrupt: corruptThisDownload });
    const stream = createReadStream(payload, { start, end, highWaterMark: Math.min(1024 * 1024, Math.max(16 * 1024, Math.floor(bytesPerSecond / 8))) });
    let corruptPending = corruptThisDownload;
    stream.on("data", chunk => {
      stream.pause();
      if (corruptPending && chunk.length > 0) {
        chunk[0] ^= 0xff;
        corruptPending = false;
        corruptNextCompleteDownload = false;
      }
      response.write(chunk);
      setTimeout(() => stream.resume(), Math.max(1, Math.ceil((chunk.length / bytesPerSecond) * 1000)));
    });
    stream.on("error", error => {
      log("stream-error", { message: error.message });
      response.destroy(error);
    });
    stream.on("end", () => response.end());
  }).listen(port, "127.0.0.1", () => log("listening", { url: "http://127.0.0.1:" + port + endpoint, throttleMbps: options.throttleMbps, corrupt: options.badPayload }));
})().catch(error => { console.error(error); process.exitCode = 1; });
