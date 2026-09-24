"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/main.ts
var import_electron = require("electron");
var import_node_path2 = __toESM(require("node:path"), 1);
var import_node_fs2 = require("node:fs");

// node_modules/@hono/node-server/dist/index.mjs
var import_http = require("http");
var import_http2 = require("http2");
var import_http22 = require("http2");
var import_stream = require("stream");
var import_crypto = __toESM(require("crypto"), 1);
var RequestError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RequestError";
  }
};
var toRequestError = (e) => {
  if (e instanceof RequestError) {
    return e;
  }
  return new RequestError(e.message, { cause: e });
};
var GlobalRequest = global.Request;
var Request2 = class extends GlobalRequest {
  constructor(input, options) {
    if (typeof input === "object" && getRequestCache in input) {
      input = input[getRequestCache]();
    }
    if (typeof options?.body?.getReader !== "undefined") {
      ;
      options.duplex ??= "half";
    }
    super(input, options);
  }
};
var newHeadersFromIncoming = (incoming) => {
  const headerRecord = [];
  const rawHeaders = incoming.rawHeaders;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const { [i]: key, [i + 1]: value } = rawHeaders;
    if (key.charCodeAt(0) !== /*:*/
    58) {
      headerRecord.push([key, value]);
    }
  }
  return new Headers(headerRecord);
};
var wrapBodyStream = /* @__PURE__ */ Symbol("wrapBodyStream");
var newRequestFromIncoming = (method, url, headers, incoming, abortController) => {
  const init = {
    method,
    headers,
    signal: abortController.signal
  };
  if (method === "TRACE") {
    init.method = "GET";
    const req = new Request2(url, init);
    Object.defineProperty(req, "method", {
      get() {
        return "TRACE";
      }
    });
    return req;
  }
  if (!(method === "GET" || method === "HEAD")) {
    if ("rawBody" in incoming && incoming.rawBody instanceof Buffer) {
      init.body = new ReadableStream({
        start(controller) {
          controller.enqueue(incoming.rawBody);
          controller.close();
        }
      });
    } else if (incoming[wrapBodyStream]) {
      let reader;
      init.body = new ReadableStream({
        async pull(controller) {
          try {
            reader ||= import_stream.Readable.toWeb(incoming).getReader();
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
            } else {
              controller.enqueue(value);
            }
          } catch (error) {
            controller.error(error);
          }
        }
      });
    } else {
      init.body = import_stream.Readable.toWeb(incoming);
    }
  }
  return new Request2(url, init);
};
var getRequestCache = /* @__PURE__ */ Symbol("getRequestCache");
var requestCache = /* @__PURE__ */ Symbol("requestCache");
var incomingKey = /* @__PURE__ */ Symbol("incomingKey");
var urlKey = /* @__PURE__ */ Symbol("urlKey");
var headersKey = /* @__PURE__ */ Symbol("headersKey");
var abortControllerKey = /* @__PURE__ */ Symbol("abortControllerKey");
var getAbortController = /* @__PURE__ */ Symbol("getAbortController");
var requestPrototype = {
  get method() {
    return this[incomingKey].method || "GET";
  },
  get url() {
    return this[urlKey];
  },
  get headers() {
    return this[headersKey] ||= newHeadersFromIncoming(this[incomingKey]);
  },
  [getAbortController]() {
    this[getRequestCache]();
    return this[abortControllerKey];
  },
  [getRequestCache]() {
    this[abortControllerKey] ||= new AbortController();
    return this[requestCache] ||= newRequestFromIncoming(
      this.method,
      this[urlKey],
      this.headers,
      this[incomingKey],
      this[abortControllerKey]
    );
  }
};
[
  "body",
  "bodyUsed",
  "cache",
  "credentials",
  "destination",
  "integrity",
  "mode",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal",
  "keepalive"
].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    get() {
      return this[getRequestCache]()[k];
    }
  });
});
["arrayBuffer", "blob", "clone", "formData", "json", "text"].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    value: function() {
      return this[getRequestCache]()[k]();
    }
  });
});
Object.defineProperty(requestPrototype, /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom"), {
  value: function(depth, options, inspectFn) {
    const props = {
      method: this.method,
      url: this.url,
      headers: this.headers,
      nativeRequest: this[requestCache]
    };
    return `Request (lightweight) ${inspectFn(props, { ...options, depth: depth == null ? null : depth - 1 })}`;
  }
});
Object.setPrototypeOf(requestPrototype, Request2.prototype);
var newRequest = (incoming, defaultHostname) => {
  const req = Object.create(requestPrototype);
  req[incomingKey] = incoming;
  const incomingUrl = incoming.url || "";
  if (incomingUrl[0] !== "/" && // short-circuit for performance. most requests are relative URL.
  (incomingUrl.startsWith("http://") || incomingUrl.startsWith("https://"))) {
    if (incoming instanceof import_http22.Http2ServerRequest) {
      throw new RequestError("Absolute URL for :path is not allowed in HTTP/2");
    }
    try {
      const url2 = new URL(incomingUrl);
      req[urlKey] = url2.href;
    } catch (e) {
      throw new RequestError("Invalid absolute URL", { cause: e });
    }
    return req;
  }
  const host = (incoming instanceof import_http22.Http2ServerRequest ? incoming.authority : incoming.headers.host) || defaultHostname;
  if (!host) {
    throw new RequestError("Missing host header");
  }
  let scheme;
  if (incoming instanceof import_http22.Http2ServerRequest) {
    scheme = incoming.scheme;
    if (!(scheme === "http" || scheme === "https")) {
      throw new RequestError("Unsupported scheme");
    }
  } else {
    scheme = incoming.socket && incoming.socket.encrypted ? "https" : "http";
  }
  const url = new URL(`${scheme}://${host}${incomingUrl}`);
  if (url.hostname.length !== host.length && url.hostname !== host.replace(/:\d+$/, "")) {
    throw new RequestError("Invalid host header");
  }
  req[urlKey] = url.href;
  return req;
};
var responseCache = /* @__PURE__ */ Symbol("responseCache");
var getResponseCache = /* @__PURE__ */ Symbol("getResponseCache");
var cacheKey = /* @__PURE__ */ Symbol("cache");
var GlobalResponse = global.Response;
var Response2 = class _Response {
  #body;
  #init;
  [getResponseCache]() {
    delete this[cacheKey];
    return this[responseCache] ||= new GlobalResponse(this.#body, this.#init);
  }
  constructor(body, init) {
    let headers;
    this.#body = body;
    if (init instanceof _Response) {
      const cachedGlobalResponse = init[responseCache];
      if (cachedGlobalResponse) {
        this.#init = cachedGlobalResponse;
        this[getResponseCache]();
        return;
      } else {
        this.#init = init.#init;
        headers = new Headers(init.#init.headers);
      }
    } else {
      this.#init = init;
    }
    if (typeof body === "string" || typeof body?.getReader !== "undefined" || body instanceof Blob || body instanceof Uint8Array) {
      ;
      this[cacheKey] = [init?.status || 200, body, headers || init?.headers];
    }
  }
  get headers() {
    const cache = this[cacheKey];
    if (cache) {
      if (!(cache[2] instanceof Headers)) {
        cache[2] = new Headers(
          cache[2] || { "content-type": "text/plain; charset=UTF-8" }
        );
      }
      return cache[2];
    }
    return this[getResponseCache]().headers;
  }
  get status() {
    return this[cacheKey]?.[0] ?? this[getResponseCache]().status;
  }
  get ok() {
    const status = this.status;
    return status >= 200 && status < 300;
  }
};
["body", "bodyUsed", "redirected", "statusText", "trailers", "type", "url"].forEach((k) => {
  Object.defineProperty(Response2.prototype, k, {
    get() {
      return this[getResponseCache]()[k];
    }
  });
});
["arrayBuffer", "blob", "clone", "formData", "json", "text"].forEach((k) => {
  Object.defineProperty(Response2.prototype, k, {
    value: function() {
      return this[getResponseCache]()[k]();
    }
  });
});
Object.defineProperty(Response2.prototype, /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom"), {
  value: function(depth, options, inspectFn) {
    const props = {
      status: this.status,
      headers: this.headers,
      ok: this.ok,
      nativeResponse: this[responseCache]
    };
    return `Response (lightweight) ${inspectFn(props, { ...options, depth: depth == null ? null : depth - 1 })}`;
  }
});
Object.setPrototypeOf(Response2, GlobalResponse);
Object.setPrototypeOf(Response2.prototype, GlobalResponse.prototype);
async function readWithoutBlocking(readPromise) {
  return Promise.race([readPromise, Promise.resolve().then(() => Promise.resolve(void 0))]);
}
function writeFromReadableStreamDefaultReader(reader, writable, currentReadPromise) {
  const cancel = (error) => {
    reader.cancel(error).catch(() => {
    });
  };
  writable.on("close", cancel);
  writable.on("error", cancel);
  (currentReadPromise ?? reader.read()).then(flow, handleStreamError);
  return reader.closed.finally(() => {
    writable.off("close", cancel);
    writable.off("error", cancel);
  });
  function handleStreamError(error) {
    if (error) {
      writable.destroy(error);
    }
  }
  function onDrain() {
    reader.read().then(flow, handleStreamError);
  }
  function flow({ done, value }) {
    try {
      if (done) {
        writable.end();
      } else if (!writable.write(value)) {
        writable.once("drain", onDrain);
      } else {
        return reader.read().then(flow, handleStreamError);
      }
    } catch (e) {
      handleStreamError(e);
    }
  }
}
function writeFromReadableStream(stream, writable) {
  if (stream.locked) {
    throw new TypeError("ReadableStream is locked.");
  } else if (writable.destroyed) {
    return;
  }
  return writeFromReadableStreamDefaultReader(stream.getReader(), writable);
}
var buildOutgoingHttpHeaders = (headers) => {
  const res = {};
  if (!(headers instanceof Headers)) {
    headers = new Headers(headers ?? void 0);
  }
  const cookies = [];
  for (const [k, v] of headers) {
    if (k === "set-cookie") {
      cookies.push(v);
    } else {
      res[k] = v;
    }
  }
  if (cookies.length > 0) {
    res["set-cookie"] = cookies;
  }
  res["content-type"] ??= "text/plain; charset=UTF-8";
  return res;
};
var X_ALREADY_SENT = "x-hono-already-sent";
if (typeof global.crypto === "undefined") {
  global.crypto = import_crypto.default;
}
var outgoingEnded = /* @__PURE__ */ Symbol("outgoingEnded");
var incomingDraining = /* @__PURE__ */ Symbol("incomingDraining");
var DRAIN_TIMEOUT_MS = 500;
var MAX_DRAIN_BYTES = 64 * 1024 * 1024;
var drainIncoming = (incoming) => {
  const incomingWithDrainState = incoming;
  if (incoming.destroyed || incomingWithDrainState[incomingDraining]) {
    return;
  }
  incomingWithDrainState[incomingDraining] = true;
  if (incoming instanceof import_http2.Http2ServerRequest) {
    try {
      ;
      incoming.stream?.close?.(import_http2.constants.NGHTTP2_NO_ERROR);
    } catch {
    }
    return;
  }
  let bytesRead = 0;
  const cleanup = () => {
    clearTimeout(timer);
    incoming.off("data", onData);
    incoming.off("end", cleanup);
    incoming.off("error", cleanup);
  };
  const forceClose = () => {
    cleanup();
    const socket = incoming.socket;
    if (socket && !socket.destroyed) {
      socket.destroySoon();
    }
  };
  const timer = setTimeout(forceClose, DRAIN_TIMEOUT_MS);
  timer.unref?.();
  const onData = (chunk) => {
    bytesRead += chunk.length;
    if (bytesRead > MAX_DRAIN_BYTES) {
      forceClose();
    }
  };
  incoming.on("data", onData);
  incoming.on("end", cleanup);
  incoming.on("error", cleanup);
  incoming.resume();
};
var handleRequestError = () => new Response(null, {
  status: 400
});
var handleFetchError = (e) => new Response(null, {
  status: e instanceof Error && (e.name === "TimeoutError" || e.constructor.name === "TimeoutError") ? 504 : 500
});
var handleResponseError = (e, outgoing) => {
  const err = e instanceof Error ? e : new Error("unknown error", { cause: e });
  if (err.code === "ERR_STREAM_PREMATURE_CLOSE") {
    console.info("The user aborted a request.");
  } else {
    console.error(e);
    if (!outgoing.headersSent) {
      outgoing.writeHead(500, { "Content-Type": "text/plain" });
    }
    outgoing.end(`Error: ${err.message}`);
    outgoing.destroy(err);
  }
};
var flushHeaders = (outgoing) => {
  if ("flushHeaders" in outgoing && outgoing.writable) {
    outgoing.flushHeaders();
  }
};
var responseViaCache = async (res, outgoing) => {
  let [status, body, header] = res[cacheKey];
  let hasContentLength = false;
  if (!header) {
    header = { "content-type": "text/plain; charset=UTF-8" };
  } else if (header instanceof Headers) {
    hasContentLength = header.has("content-length");
    header = buildOutgoingHttpHeaders(header);
  } else if (Array.isArray(header)) {
    const headerObj = new Headers(header);
    hasContentLength = headerObj.has("content-length");
    header = buildOutgoingHttpHeaders(headerObj);
  } else {
    for (const key in header) {
      if (key.length === 14 && key.toLowerCase() === "content-length") {
        hasContentLength = true;
        break;
      }
    }
  }
  if (!hasContentLength) {
    if (typeof body === "string") {
      header["Content-Length"] = Buffer.byteLength(body);
    } else if (body instanceof Uint8Array) {
      header["Content-Length"] = body.byteLength;
    } else if (body instanceof Blob) {
      header["Content-Length"] = body.size;
    }
  }
  outgoing.writeHead(status, header);
  if (typeof body === "string" || body instanceof Uint8Array) {
    outgoing.end(body);
  } else if (body instanceof Blob) {
    outgoing.end(new Uint8Array(await body.arrayBuffer()));
  } else {
    flushHeaders(outgoing);
    await writeFromReadableStream(body, outgoing)?.catch(
      (e) => handleResponseError(e, outgoing)
    );
  }
  ;
  outgoing[outgoingEnded]?.();
};
var isPromise = (res) => typeof res.then === "function";
var responseViaResponseObject = async (res, outgoing, options = {}) => {
  if (isPromise(res)) {
    if (options.errorHandler) {
      try {
        res = await res;
      } catch (err) {
        const errRes = await options.errorHandler(err);
        if (!errRes) {
          return;
        }
        res = errRes;
      }
    } else {
      res = await res.catch(handleFetchError);
    }
  }
  if (cacheKey in res) {
    return responseViaCache(res, outgoing);
  }
  const resHeaderRecord = buildOutgoingHttpHeaders(res.headers);
  if (res.body) {
    const reader = res.body.getReader();
    const values = [];
    let done = false;
    let currentReadPromise = void 0;
    if (resHeaderRecord["transfer-encoding"] !== "chunked") {
      let maxReadCount = 2;
      for (let i = 0; i < maxReadCount; i++) {
        currentReadPromise ||= reader.read();
        const chunk = await readWithoutBlocking(currentReadPromise).catch((e) => {
          console.error(e);
          done = true;
        });
        if (!chunk) {
          if (i === 1) {
            await new Promise((resolve) => setTimeout(resolve));
            maxReadCount = 3;
            continue;
          }
          break;
        }
        currentReadPromise = void 0;
        if (chunk.value) {
          values.push(chunk.value);
        }
        if (chunk.done) {
          done = true;
          break;
        }
      }
      if (done && !("content-length" in resHeaderRecord)) {
        resHeaderRecord["content-length"] = values.reduce((acc, value) => acc + value.length, 0);
      }
    }
    outgoing.writeHead(res.status, resHeaderRecord);
    values.forEach((value) => {
      ;
      outgoing.write(value);
    });
    if (done) {
      outgoing.end();
    } else {
      if (values.length === 0) {
        flushHeaders(outgoing);
      }
      await writeFromReadableStreamDefaultReader(reader, outgoing, currentReadPromise);
    }
  } else if (resHeaderRecord[X_ALREADY_SENT]) {
  } else {
    outgoing.writeHead(res.status, resHeaderRecord);
    outgoing.end();
  }
  ;
  outgoing[outgoingEnded]?.();
};
var getRequestListener = (fetchCallback, options = {}) => {
  const autoCleanupIncoming = options.autoCleanupIncoming ?? true;
  if (options.overrideGlobalObjects !== false && global.Request !== Request2) {
    Object.defineProperty(global, "Request", {
      value: Request2
    });
    Object.defineProperty(global, "Response", {
      value: Response2
    });
  }
  return async (incoming, outgoing) => {
    let res, req;
    try {
      req = newRequest(incoming, options.hostname);
      let incomingEnded = !autoCleanupIncoming || incoming.method === "GET" || incoming.method === "HEAD";
      if (!incomingEnded) {
        ;
        incoming[wrapBodyStream] = true;
        incoming.on("end", () => {
          incomingEnded = true;
        });
        if (incoming instanceof import_http2.Http2ServerRequest) {
          ;
          outgoing[outgoingEnded] = () => {
            if (!incomingEnded) {
              setTimeout(() => {
                if (!incomingEnded) {
                  setTimeout(() => {
                    drainIncoming(incoming);
                  });
                }
              });
            }
          };
        }
        outgoing.on("finish", () => {
          if (!incomingEnded) {
            drainIncoming(incoming);
          }
        });
      }
      outgoing.on("close", () => {
        const abortController = req[abortControllerKey];
        if (abortController) {
          if (incoming.errored) {
            req[abortControllerKey].abort(incoming.errored.toString());
          } else if (!outgoing.writableFinished) {
            req[abortControllerKey].abort("Client connection prematurely closed.");
          }
        }
        if (!incomingEnded) {
          setTimeout(() => {
            if (!incomingEnded) {
              setTimeout(() => {
                drainIncoming(incoming);
              });
            }
          });
        }
      });
      res = fetchCallback(req, { incoming, outgoing });
      if (cacheKey in res) {
        return responseViaCache(res, outgoing);
      }
    } catch (e) {
      if (!res) {
        if (options.errorHandler) {
          res = await options.errorHandler(req ? e : toRequestError(e));
          if (!res) {
            return;
          }
        } else if (!req) {
          res = handleRequestError();
        } else {
          res = handleFetchError(e);
        }
      } else {
        return handleResponseError(e, outgoing);
      }
    }
    try {
      return await responseViaResponseObject(res, outgoing, options);
    } catch (e) {
      return handleResponseError(e, outgoing);
    }
  };
};
var createAdaptorServer = (options) => {
  const fetchCallback = options.fetch;
  const requestListener = getRequestListener(fetchCallback, {
    hostname: options.hostname,
    overrideGlobalObjects: options.overrideGlobalObjects,
    autoCleanupIncoming: options.autoCleanupIncoming
  });
  const createServer = options.createServer || import_http.createServer;
  const server = createServer(options.serverOptions || {}, requestListener);
  return server;
};
var serve = (options, listeningListener) => {
  const server = createAdaptorServer(options);
  server.listen(options?.port ?? 3e3, options.hostname, () => {
    const serverInfo = server.address();
    listeningListener && listeningListener(serverInfo);
  });
  return server;
};

// node_modules/hono/dist/utils/mime.js
var getMimeType = (filename, mimes = baseMimes) => {
  const regexp = /\.([a-zA-Z0-9]+?)$/;
  const match2 = filename.match(regexp);
  if (!match2) {
    return;
  }
  return mimes[match2[1].toLowerCase()];
};
var _baseMimes = {
  aac: "audio/aac",
  avi: "video/x-msvideo",
  avif: "image/avif",
  av1: "video/av1",
  bin: "application/octet-stream",
  bmp: "image/bmp",
  css: "text/css; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  eot: "application/vnd.ms-fontobject",
  epub: "application/epub+zip",
  gif: "image/gif",
  gz: "application/gzip",
  htm: "text/html; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  ics: "text/calendar; charset=utf-8",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
  jsonld: "application/ld+json",
  map: "application/json",
  mid: "audio/x-midi",
  midi: "audio/x-midi",
  mjs: "text/javascript; charset=utf-8",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  oga: "audio/ogg",
  ogv: "video/ogg",
  ogx: "application/ogg",
  opus: "audio/opus",
  otf: "font/otf",
  pdf: "application/pdf",
  png: "image/png",
  rtf: "application/rtf",
  svg: "image/svg+xml; charset=utf-8",
  tif: "image/tiff",
  tiff: "image/tiff",
  ts: "video/mp2t",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  webm: "video/webm",
  weba: "audio/webm",
  webmanifest: "application/manifest+json",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xhtml: "application/xhtml+xml; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  zip: "application/zip",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  gltf: "model/gltf+json",
  glb: "model/gltf-binary"
};
var baseMimes = _baseMimes;

// node_modules/@hono/node-server/dist/serve-static.mjs
var import_fs = require("fs");
var import_path = require("path");
var import_process = require("process");
var import_stream2 = require("stream");
var COMPRESSIBLE_CONTENT_TYPE_REGEX = /^\s*(?:text\/[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i;
var ENCODINGS = {
  br: ".br",
  zstd: ".zst",
  gzip: ".gz"
};
var ENCODINGS_ORDERED_KEYS = Object.keys(ENCODINGS);
var pr54206Applied = () => {
  const [major, minor] = import_process.versions.node.split(".").map((component) => parseInt(component));
  return major >= 23 || major === 22 && minor >= 7 || major === 20 && minor >= 18;
};
var useReadableToWeb = pr54206Applied();
var createStreamBody = (stream) => {
  if (useReadableToWeb) {
    return import_stream2.Readable.toWeb(stream);
  }
  const body = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => {
        controller.enqueue(chunk);
      });
      stream.on("error", (err) => {
        controller.error(err);
      });
      stream.on("end", () => {
        controller.close();
      });
    },
    cancel() {
      stream.destroy();
    }
  });
  return body;
};
var getStats = (path3) => {
  let stats;
  try {
    stats = (0, import_fs.statSync)(path3);
  } catch {
  }
  return stats;
};
var tryDecode = (str2, decoder) => {
  try {
    return decoder(str2);
  } catch {
    return str2.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
};
var tryDecodeURI = (str2) => tryDecode(str2, decodeURI);
var serveStatic = (options = { root: "" }) => {
  const root = options.root || "";
  const optionPath = options.path;
  if (root !== "" && !(0, import_fs.existsSync)(root)) {
    console.error(`serveStatic: root path '${root}' is not found, are you sure it's correct?`);
  }
  return async (c, next) => {
    if (c.finalized) {
      return next();
    }
    let filename;
    if (optionPath) {
      filename = optionPath;
    } else {
      try {
        filename = tryDecodeURI(c.req.path);
        if (/(?:^|[\/\\])\.{1,2}(?:$|[\/\\])|[\/\\]{2,}|\\/.test(filename)) {
          throw new Error();
        }
      } catch {
        await options.onNotFound?.(c.req.path, c);
        return next();
      }
    }
    let path3 = (0, import_path.join)(
      root,
      !optionPath && options.rewriteRequestPath ? options.rewriteRequestPath(filename, c) : filename
    );
    let stats = getStats(path3);
    if (stats && stats.isDirectory()) {
      const indexFile = options.index ?? "index.html";
      path3 = (0, import_path.join)(path3, indexFile);
      stats = getStats(path3);
    }
    if (!stats) {
      await options.onNotFound?.(path3, c);
      return next();
    }
    const mimeType = getMimeType(path3);
    c.header("Content-Type", mimeType || "application/octet-stream");
    if (options.precompressed && (!mimeType || COMPRESSIBLE_CONTENT_TYPE_REGEX.test(mimeType))) {
      const acceptEncodingSet = new Set(
        c.req.header("Accept-Encoding")?.split(",").map((encoding) => encoding.trim())
      );
      for (const encoding of ENCODINGS_ORDERED_KEYS) {
        if (!acceptEncodingSet.has(encoding)) {
          continue;
        }
        const precompressedStats = getStats(path3 + ENCODINGS[encoding]);
        if (precompressedStats) {
          c.header("Content-Encoding", encoding);
          c.header("Vary", "Accept-Encoding", { append: true });
          stats = precompressedStats;
          path3 = path3 + ENCODINGS[encoding];
          break;
        }
      }
    }
    let result;
    const size = stats.size;
    const range = c.req.header("range") || "";
    if (c.req.method == "HEAD" || c.req.method == "OPTIONS") {
      c.header("Content-Length", size.toString());
      c.status(200);
      result = c.body(null);
    } else if (!range) {
      c.header("Content-Length", size.toString());
      result = c.body(createStreamBody((0, import_fs.createReadStream)(path3)), 200);
    } else {
      c.header("Accept-Ranges", "bytes");
      c.header("Date", stats.birthtime.toUTCString());
      const parts = range.replace(/bytes=/, "").split("-", 2);
      const start = parseInt(parts[0], 10) || 0;
      let end = parseInt(parts[1], 10) || size - 1;
      if (size < end - start + 1) {
        end = size - 1;
      }
      const chunksize = end - start + 1;
      const stream = (0, import_fs.createReadStream)(path3, { start, end });
      c.header("Content-Length", chunksize.toString());
      c.header("Content-Range", `bytes ${start}-${end}/${stats.size}`);
      result = c.body(createStreamBody(stream), 206);
    }
    await options.onFound?.(path3, c);
    return result;
  };
};

// node_modules/hono/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
  };
};

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/buffer.js
var bufferToFormData = (arrayBuffer, contentType) => {
  const response = new Response(arrayBuffer, {
    headers: {
      // Normalize the media type (case-insensitive) while keeping parameters like the boundary
      "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase())
    }
  });
  return response.formData();
};

// node_modules/hono/dist/utils/body.js
var MAX_NESTING_DEPTH = 32;
var MAX_NESTED_OBJECTS = 1e4;
var isRawRequest = (request) => "headers" in request;
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const contentType = headers.get("Content-Type");
  const mediaType = contentType?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") {
    return parseFormData(request, { all, dot });
  }
  return {};
};
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData) {
    return convertFormDataToBodyData(
      await request.bodyCache.formData,
      options
    );
  }
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) {
    request.bodyCache.formData = formDataPromise;
  }
  const formData = await formDataPromise;
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  const nestingState = { count: 0 };
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value, nestingState);
        delete form[key];
      }
    });
  }
  return form;
}
var handleParsingAllValues = (form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
};
var handleParsingNestedValues = (form, key, value, state) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".", MAX_NESTING_DEPTH + 2);
  if (keys.length > MAX_NESTING_DEPTH + 1) {
    throwNestingLimitExceeded();
  }
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        if (state.count++ >= MAX_NESTED_OBJECTS) {
          throwNestingLimitExceeded();
        }
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
};
var throwNestingLimitExceeded = () => {
  throw new Error("Nesting limit exceeded");
};

// node_modules/hono/dist/utils/url.js
var splitPath = (path3) => {
  const paths = path3.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
};
var splitRoutingPath = (routePath) => {
  const { groups, path: path3 } = extractGroupsFromPath(routePath);
  const paths = splitPath(path3);
  return replaceGroupMarks(paths, groups);
};
var extractGroupsFromPath = (path3) => {
  const groups = [];
  path3 = path3.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path: path3 };
};
var replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey2 = `${label}#${next}`;
    if (!patternCache[cacheKey2]) {
      if (match2[2]) {
        patternCache[cacheKey2] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey2, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey2] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey2];
  }
  return null;
};
var tryDecode2 = (str2, decoder) => {
  try {
    return decoder(str2);
  } catch {
    return str2.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
};
var tryDecodeURI2 = (str2) => tryDecode2(str2, decodeURI);
var getPath = (request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path3 = url.slice(start, end);
      return tryDecodeURI2(path3.includes("%25") ? path3.replace(/%25/g, "%2525") : path3);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
};
var getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path3) => {
  if (path3.charCodeAt(path3.length - 1) !== 63 || !path3.includes(":")) {
    return null;
  }
  const segments = path3.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (segment.charCodeAt(segment.length - 1) === 63) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.slice(0, -1);
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
};
var tryDecodeURIComponent = (str2) => str2.indexOf("%") !== -1 ? tryDecode2(str2, decodeURIComponent_) : str2;
var _decodeURI = (value) => {
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return tryDecodeURIComponent(value);
};
var _getQueryParam = (url, key, multiple) => {
  const hashIndex = url.indexOf("#", 8);
  if (hashIndex !== -1) {
    url = url.slice(0, hashIndex);
  }
  let encoded;
  if (!multiple && key && key.indexOf("%") === -1 && key.indexOf("+") === -1) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = /* @__PURE__ */ Object.create(null);
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var HonoRequest = class {
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path3 = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path3;
    this.#matchResult = matchResult;
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex]?.[1][key];
    const param = this.#getParamValue(paramKey);
    return param && tryDecodeURIComponent(param);
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex]?.[1] ?? {});
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = tryDecodeURIComponent(value);
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    for (const anyCachedKey in bodyCache) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        const contentType = anyCachedKey === "formData" ? void 0 : raw2.headers.get("content-type");
        return new Response(body, {
          headers: contentType ? { "Content-Type": contentType } : void 0
        })[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  };
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * `.bytes()` parses the request body as a `Uint8Array`.
   *
   * @see {@link https://hono.dev/docs/api/request#bytes}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.bytes()
   * })
   * ```
   */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    ;
    (this.#validatedData ??= {})[target] = data;
  }
  valid(target) {
    return this.#validatedData?.[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var resolveCallback = async (str2, phase, preserveCallbacks, context, buffer) => {
  if (typeof str2 === "object" && !(str2 instanceof String)) {
    if (!(str2 instanceof Promise)) {
      str2 = str2.toString();
    }
    if (str2 instanceof Promise) {
      str2 = await str2;
    }
  }
  const callbacks = str2.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str2);
  }
  if (buffer) {
    buffer[0] += str2;
  } else {
    buffer = [str2];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str22) => resolveCallback(str22, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
};

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = (contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
};
var createResponseInstance = (body, init) => new Response(body, init);
var Context = class {
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = (layout) => this.#layout = layout;
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = () => this.#layout;
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   // Append multiple headers using the append option (e.g. Vary)
   *   c.header('Vary', 'Accept-Encoding', { append: true })
   *   c.header('Vary', 'User-Agent', { append: true })
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = (name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  };
  status = (status) => {
    this.#status = status;
  };
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    let responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders;
    if (typeof arg === "object" && arg.headers) {
      responseHeaders ??= new Headers();
      for (const [key, value] of new Headers(arg.headers)) {
        if (key === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      if (!responseHeaders) {
        let count = 0;
        for (const k in headers) {
          if (++count > 1 || typeof headers[k] !== "string") {
            responseHeaders = new Headers();
            break;
          }
        }
      }
      if (responseHeaders) {
        for (const k in headers) {
          const v = headers[k];
          if (typeof v === "string") {
            responseHeaders.set(k, v);
          } else {
            responseHeaders.delete(k);
            for (const v2 of v) {
              responseHeaders.append(k, v2);
            }
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, {
      status,
      headers: responseHeaders ?? headers
    });
  }
  newResponse = (...args) => this.#newResponse(...args);
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  };
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = (object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  };
  html = (html, arg, headers) => {
    const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibytes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  };
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = () => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  };
};

// node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch", "query"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = (c) => {
  return c.text("404 Not Found", 404);
};
var errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
};
var Hono = class _Hono {
  get;
  post;
  put;
  delete;
  options;
  patch;
  query;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        const methodName = method.toUpperCase();
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(methodName, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(methodName, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path3, ...handlers) => {
      for (const p of [path3].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          const methodName = m.toUpperCase();
          for (const handler of handlers) {
            this.#addRoute(methodName, this.#path, handler);
          }
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path3, app2) {
    const subApp = this.basePath(path3);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res;
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path3) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path3);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path3, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = (request) => request;
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path3);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    };
    this.#addRoute(METHOD_NAME_ALL, mergePath(path3, "*"), handler);
    return this;
  }
  #addRoute(method, path3, handler, baseRoutePath) {
    path3 = mergePath(this._basePath, path3);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path: path3,
      method,
      handler
    };
    this.router.add(method, path3, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path3 = this.getPath(request, { env });
    const matchResult = this.router.match(method, path3);
    const c = new Context(request, {
      path: path3,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} env - env Object
   * @param {ExecutionContext} executionCtx - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  };
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
};

// node_modules/hono/dist/router/utils.js
var createNullObject = () => /* @__PURE__ */ Object.create(null);

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path3) {
  const matchers = this.buildAllMatchers();
  const match2 = ((method2, path22) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path22];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path22.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  });
  this.match = match2;
  return match2(method, path3);
}

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return b === TAIL_WILDCARD_REG_EXP_STR ? -1 : 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var Node = class _Node {
  // handler index of a dynamic path, or -1 for a static path terminal
  #index;
  #varIndex;
  #children = createNullObject();
  insert(tokens, index, paramMap, context, isStatic) {
    let node = this;
    for (let i = 0, len = tokens.length; i < len; i++) {
      const token = tokens[i];
      const pattern = token.length === 1 ? token === "*" ? i === len - 1 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : null : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
      let nextNode;
      if (pattern) {
        const name = pattern[1];
        let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
        if (name && pattern[2]) {
          if (regexpStr === ".*") {
            throw PATH_ERROR;
          }
          regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
          if (/\((?!\?:)/.test(regexpStr)) {
            throw PATH_ERROR;
          }
          if (regexpStr.length === 1 && regExpMetaChars.has(regexpStr)) {
            throw PATH_ERROR;
          }
        }
        nextNode = node.#children[regexpStr];
        if (!nextNode) {
          if (regexpStr !== ONLY_WILDCARD_REG_EXP_STR && regexpStr !== TAIL_WILDCARD_REG_EXP_STR) {
            for (const k in node.#children) {
              if (
                // a single-char pattern coexists with single-char literals as a literal does
                (regexpStr.length > 1 || k.length > 1) && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
              ) {
                throw PATH_ERROR;
              }
            }
          }
          nextNode = node.#children[regexpStr] = new _Node();
        }
        if (name !== "") {
          nextNode.#varIndex ??= context.varIndex++;
          paramMap.push([name, nextNode.#varIndex]);
        }
      } else {
        nextNode = node.#children[token];
        if (!nextNode) {
          for (const k in node.#children) {
            if (k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR) {
              throw PATH_ERROR;
            }
          }
          nextNode = node.#children[token] = new _Node();
        }
      }
      node = nextNode;
    }
    if (node.#index !== void 0) {
      throw PATH_ERROR;
    }
    node.#index = isStatic ? -1 : index;
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      const childStr = c.buildRegExpStr();
      return childStr === "" ? "" : (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + childStr;
    }).filter(Boolean);
    if (typeof this.#index === "number" && this.#index !== -1) {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  #context = { varIndex: 0 };
  #root = new Node();
  #index = 0;
  // dynamic path -> [handler index, param assoc]; static paths are not registered
  paths = createNullObject();
  insert(path3, isStatic) {
    if (isStatic) {
      this.#root.insert(path3.split(""), 0, [], this.#context, true);
      return;
    }
    const paramAssoc = [];
    const groups = [];
    let markedPath = path3;
    for (let i = 0; ; ) {
      let replaced = false;
      markedPath = markedPath.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = markedPath.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, this.#index, paramAssoc, this.#context, false);
    this.paths[path3] = [this.#index++, paramAssoc];
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var wildcardRegExpCache = createNullObject();
function buildWildcardRegExp(path3) {
  return wildcardRegExpCache[path3] ??= new RegExp(
    `^${path3.replace(
      /\/:[^/{}]+(?:\{\[\^\/]\+})?(?=[/{]|$)|\/?\*$|([.\\+*[^\]$()?{}|])/g,
      (match2, metaChar) => metaChar ? `\\${metaChar}` : match2 === "/*" ? TAIL_WILDCARD_REG_EXP_STR : match2 === "*" ? ONLY_WILDCARD_REG_EXP_STR : `/:${LABEL_REG_EXP_STR}`
    )}$`
  );
}
function findMiddleware(middleware, path3) {
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path3)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
var RegExpRouter = class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  #tries;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: createNullObject() };
    this.#routes = { [METHOD_NAME_ALL]: createNullObject() };
    this.#tries = { [METHOD_NAME_ALL]: new Trie() };
  }
  #insertPath(method, path3) {
    try {
      this.#tries[method].insert(path3, !/\*|\/:/.test(path3));
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path3) : e;
    }
  }
  add(method, path3, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      this.#tries[method] = new Trie();
      for (const handlerMap of [middleware, routes]) {
        handlerMap[method] = createNullObject();
        for (const p in handlerMap[METHOD_NAME_ALL]) {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
          this.#insertPath(method, p);
        }
      }
    }
    if (path3 === "/*") {
      path3 = "*";
    }
    const methods = method === METHOD_NAME_ALL ? Object.keys(middleware) : [method];
    if (/\*$/.test(path3)) {
      const re = buildWildcardRegExp(path3);
      for (const m of methods) {
        if (!middleware[m][path3]) {
          this.#insertPath(m, path3);
          middleware[m][path3] = findMiddleware(middleware[m], path3) || findMiddleware(middleware[METHOD_NAME_ALL], path3) || [];
        }
      }
      for (const handlerMap of [middleware, routes]) {
        for (const m of methods) {
          for (const p in handlerMap[m]) {
            re.test(p) && handlerMap[m][p].push([handler, path3]);
          }
        }
      }
      return;
    }
    const paths = checkOptionalParameter(path3) || [path3];
    for (const path22 of paths) {
      for (const m of methods) {
        if (!routes[m][path22]) {
          this.#insertPath(m, path22);
          routes[m][path22] = findMiddleware(middleware[m], path22) || findMiddleware(middleware[METHOD_NAME_ALL], path22) || [];
        }
        routes[m][path22].push([handler, path22]);
      }
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = createNullObject();
    for (const method of Object.keys(this.#routes)) {
      matchers[method] = this.#buildMatcher(method);
    }
    this.#middleware = this.#routes = this.#tries = void 0;
    wildcardRegExpCache = createNullObject();
    return matchers;
  }
  #buildMatcher(method) {
    const middleware = this.#middleware[method];
    const routes = this.#routes[method];
    const trie = this.#tries[method];
    const staticMap = createNullObject();
    const handlerData = [];
    const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
    for (const r of [middleware, routes]) {
      for (const path3 in r) {
        const handlers = r[path3];
        const pathData = trie.paths[path3];
        if (!pathData) {
          staticMap[path3] = [handlers.map(([h]) => [h, createNullObject()]), emptyParam];
          continue;
        }
        handlerData[pathData[0]] = handlers.map(([h, handlerPath]) => [
          h,
          trie.paths[handlerPath][1].reduceRight((map, [key], i) => {
            map[key] = paramReplacementMap[pathData[1][i][1]];
            return map;
          }, createNullObject())
        ]);
      }
    }
    return [regexp, indexReplacementMap.map((i) => handlerData[i]), staticMap];
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path3, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path3, handler]);
  }
  match(method, path3) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path3);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = createNullObject();
var order = 0;
var Node2 = class _Node2 {
  #methods = [];
  #children = createNullObject();
  #patterns = [];
  #pattern;
  #params = emptyParams;
  insert(method, path3, handler) {
    let curNode = this;
    const parts = splitRoutingPath(path3);
    const possibleKeys = /* @__PURE__ */ new Set();
    let i = 0;
    for (const p of parts) {
      const nextP = parts[++i];
      const pattern = getPattern(p, nextP) || (nextP === void 0 && p && p.indexOf("*") === p.length - 1 ? p : null);
      const isParam = Array.isArray(pattern);
      const key = isParam ? pattern[0] : pattern || p;
      const child = curNode.#children[key] ||= new _Node2();
      if (pattern && !child.#pattern) {
        child.#pattern = pattern;
        curNode.#patterns.push(child);
      }
      curNode = child;
      if (isParam) {
        possibleKeys.add(pattern[1]);
      }
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: [...possibleKeys],
        score: ++order
      }
    });
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      if (handlerSet) {
        handlerSet.params = createNullObject();
        handlerSets.push(handlerSet);
        for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
          const key = handlerSet.possibleKeys[i2];
          handlerSet.params[key] = params?.[key] && !i2 ? params[key] : nodeParams[key] ?? params?.[key];
        }
      }
    }
  }
  search(method, path3) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path3);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (const child of node.#patterns) {
          const pattern = child.#pattern;
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (typeof pattern === "string") {
            if (pattern === "*" || part.startsWith(pattern.slice(0, -1))) {
              this.#pushHandlerSets(handlerSets, child, method, node.#params);
              if (pattern === "*") {
                child.#params = params;
                tempNodes.push(child);
              }
            }
            continue;
          }
          const [, name, matcher] = pattern;
          if (!part && matcher === true) {
            continue;
          }
          if (matcher !== true) {
            if (!partOffsets) {
              partOffsets = [];
              let offset = path3[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path3.slice(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  node.#params,
                  params
                );
              }
              for (const _ in child.#children) {
                child.#params = params;
                const componentCount = m[0].match(/\//g)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
                break;
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets[1]) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  name = "TrieRouter";
  #node = new Node2();
  add(method, path3, handler) {
    for (const result of checkOptionalParameter(path3) || [path3]) {
      this.#node.insert(method, result, handler);
    }
  }
  match(method, path3) {
    return this.#node.search(method, path3);
  }
};

// node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// src/core/parser/rulesParser.ts
var LEVELS = {
  low: "low",
  medium: "medium",
  high: "high"
};
var TASK_RULES = [
  { pattern: /(写代码|敲代码|编程|开发|debug|调试|码代码)/i, apply: (d) => d.task = "\u5199\u4EE3\u7801" },
  { pattern: /(复习|备考|温书|考试|刷题|做卷子)/, apply: (d) => d.task = "\u590D\u4E60\u5907\u8003" },
  { pattern: /(写论文|论文|写作业|赶报告|写报告|写文档|写文章|写作)/, apply: (d) => d.task = "\u5199\u4F5C" },
  { pattern: /(读书|看书|阅读|文献)/, apply: (d) => d.task = "\u9605\u8BFB" },
  { pattern: /(背单词|学外语|学英语|网课|听课|上课|做题库)/, apply: (d) => d.task = "\u4E0A\u8BFE\u5B66\u4E60" },
  { pattern: /(加班|上班|处理工作|工作)/, apply: (d) => d.task = "\u5DE5\u4F5C" },
  { pattern: /(画图|设计|剪视频|剪片|做图|渲染|建模)/, apply: (d) => d.task = "\u8BBE\u8BA1\u521B\u4F5C" }
];
var ENERGY_RULES = [
  // 注意：特例（"有点累"=中度）必须先于一般规则（"累"=低度）判定
  {
    pattern: /(有点累|有点儿累|有点困|还行|一般般|状态一般|还算精神)/,
    apply: (d) => {
      if (!d.energy) d.energy = LEVELS.medium;
    }
  },
  {
    pattern: /(累|疲惫|疲倦|困|乏|没力气|没劲|精疲力尽|心力交瘁|头昏|提不起精神|熬不动)/,
    apply: (d) => {
      if (!d.energy) d.energy = LEVELS.low;
    }
  },
  {
    pattern: /(精力充沛|精神满满|精神很好|状态很好|亢奋|睡不着|特别清醒|元气满满)/,
    apply: (d) => {
      if (!d.energy) d.energy = LEVELS.high;
    }
  }
];
var STRESS_RULES = [
  {
    pattern: /(压力大|很紧张|太紧张|焦虑|心慌|发愁|愁得|烦躁|烦得|喘不过气|内耗|崩不住|绷不住)/,
    apply: (d) => {
      if (!d.stress) d.stress = LEVELS.high;
    }
  },
  {
    pattern: /(没什么压力|没有压力|毫无压力|很放松|挺放松|放松|轻松)/,
    apply: (d) => {
      if (!d.stress) d.stress = LEVELS.low;
    }
  }
];
var FOCUS_RULES = [
  {
    pattern: /(走神|分心|跑神|注意力不集中|无法集中|不能集中|静不下心|坐不住|专注不了|容易被打断|脑子乱|思绪乱)/,
    apply: (d) => {
      if (!d.focusDifficulty) d.focusDifficulty = LEVELS.high;
    }
  },
  {
    pattern: /(很专注|特别专注|沉浸|心流|状态很稳)/,
    apply: (d) => {
      if (!d.focusDifficulty) d.focusDifficulty = LEVELS.low;
    }
  }
];
var MOOD_RULES = [
  { mood: "irritable", pattern: /(烦躁|烦|上火|毛躁)/, apply: (d) => pushMood(d, "irritable") },
  { mood: "anxious", pattern: /(焦虑|担心|紧张|心神不宁)/, apply: (d) => pushMood(d, "anxious") },
  { mood: "down", pattern: /(低落|难过|伤心|emo|丧|郁闷|不开心|沮丧)/i, apply: (d) => pushMood(d, "down") },
  { mood: "bored", pattern: /(无聊|乏味|提不起兴趣)/, apply: (d) => pushMood(d, "bored") },
  { mood: "happy", pattern: /(开心|高兴|愉快|兴奋|期待)/, apply: (d) => pushMood(d, "happy") },
  { mood: "lonely", pattern: /(孤独|寂寞|一个人)/, apply: (d) => pushMood(d, "lonely") },
  { mood: "calm", pattern: /(平静|心如止水|很稳)/, apply: (d) => pushMood(d, "calm") }
];
var PREF_RULES = [
  // 整体安静程度
  {
    pattern: /(安静|轻柔|舒缓|柔和|温柔|平静一点|静一点|低沉|催眠|放松的音乐|白噪音|氛围)/,
    apply: (d) => d.prefs.calmness = "calm"
  },
  {
    pattern: /(提神|醒脑|有劲|带感|燃|动感|节奏感|热血|嗨|活力|激昂)/,
    apply: (d) => d.prefs.calmness = "energetic"
  },
  // 人声/歌词
  {
    pattern: /(纯音乐|没有人声|不要人声|无人声|没有歌词|不要歌词|instrumental|白噪音|钢琴曲|轻音乐)/i,
    apply: (d) => d.prefs.vocalPreference = "instrumental"
  },
  {
    pattern: /(歌词少|少歌词|人声少|没什么歌词|少一点歌词|别有人声|不要唱|少唱)/,
    apply: (d) => d.prefs.vocalPreference = "few-lyrics"
  },
  // 流派
  { pattern: /lo-?fi|低保真/i, apply: (d) => pushGenre(d, "lofi") },
  { pattern: /(古典|交响|室内乐|巴洛克)/, apply: (d) => pushGenre(d, "classical") },
  { pattern: /(钢琴)/, apply: (d) => pushGenre(d, "piano") },
  { pattern: /(后摇|post-?rock)/i, apply: (d) => pushGenre(d, "post-rock") },
  { pattern: /(电子|电音|edm|synth|合成器)/i, apply: (d) => pushGenre(d, "electronic") },
  { pattern: /(爵士|jazz)/i, apply: (d) => pushGenre(d, "jazz") },
  { pattern: /(民谣|folk)/i, apply: (d) => pushGenre(d, "folk") },
  { pattern: /(摇滚|rock)/i, apply: (d) => pushGenre(d, "rock") },
  { pattern: /(流行|pop)/i, apply: (d) => pushGenre(d, "pop") },
  { pattern: /(city\s?pop|城市流行|都市流行)/i, apply: (d) => pushGenre(d, "city-pop") },
  { pattern: /(acg|动漫|二次元|游戏音乐|ost|原声)/i, apply: (d) => pushGenre(d, "acg") },
  // 语言
  { pattern: /(中文歌|国语|华语)/, apply: (d) => pushLang(d, "zh") },
  { pattern: /(英文歌|英语|欧美)/, apply: (d) => pushLang(d, "en") },
  { pattern: /(日语歌|日文歌|日语|日系)/, apply: (d) => pushLang(d, "ja") },
  { pattern: /(韩语歌|韩文歌|韩语|k-?pop)/i, apply: (d) => pushLang(d, "ko") }
];
var CN_NUM = {
  \u4E00: 1,
  \u4E24: 2,
  \u4E8C: 2,
  \u4E09: 3,
  \u56DB: 4,
  \u4E94: 5,
  \u516D: 6,
  \u4E03: 7,
  \u516B: 8,
  \u4E5D: 9,
  \u5341: 10
};
function parseDurationMinutes(input) {
  const half = input.match(/([0-9一两二三四五六七八九十]+)\s*个?半\s*[个]?\s*小时/);
  if (half && half[1] !== void 0) {
    const h = toNumber(half[1]);
    if (h !== void 0) return (h + 0.5) * 60;
  }
  const hours = input.match(/([0-9一两二三四五六七八九十半]+)\s*[个]?\s*小时/);
  if (hours && hours[1] !== void 0) {
    const h = toNumber(hours[1]);
    if (h !== void 0) return Math.round(h * 60);
  }
  const minutes = input.match(/([0-9一两二三四五六七八九十半百]+)\s*分\s*[钟]?/);
  if (minutes && minutes[1] !== void 0) {
    const m = toNumber(minutes[1]);
    if (m !== void 0) return m;
  }
  if (/一整天|整天/.test(input)) return 480;
  if (/一下午/.test(input)) return 180;
  if (/一上午/.test(input)) return 180;
  if (/(一)?晚上/.test(input) && !/今晚|今晚就/.test(input)) return 150;
  return void 0;
}
function toNumber(text) {
  if (/^[0-9]+$/.test(text)) return Number.parseInt(text, 10);
  if (text === "\u534A") return 0.5;
  if (text.length === 1 && CN_NUM[text] !== void 0) return CN_NUM[text];
  if (text === "\u5341") return 10;
  const m = text.match(/^(十|([一二两三四五六七八九])?十)?([一二两三四五六七八九]?)$/);
  if (m) {
    const tens = m[2] !== void 0 ? CN_NUM[m[2]] : m[1] === "\u5341" ? 1 : void 0;
    const ones = m[3] !== void 0 && m[3] !== "" ? CN_NUM[m[3]] : 0;
    if (tens !== void 0 && ones !== void 0) return tens * 10 + ones;
  }
  return void 0;
}
function parseContext(input) {
  const text = input.trim();
  const draft = {
    moods: [],
    prefs: {},
    matched: []
  };
  const applyRules = (rules) => {
    for (const rule of rules) {
      const hit = text.match(rule.pattern);
      if (hit) {
        rule.apply(draft);
        draft.matched.push(hit[0] ?? "");
      }
    }
  };
  applyRules(TASK_RULES);
  applyRules(ENERGY_RULES);
  applyRules(STRESS_RULES);
  applyRules(FOCUS_RULES);
  for (const rule of MOOD_RULES) {
    const hit = text.match(rule.pattern);
    if (hit) {
      rule.apply(draft);
      draft.matched.push(hit[0] ?? "");
    }
  }
  applyRules(PREF_RULES);
  const duration = parseDurationMinutes(text);
  if (duration !== void 0) {
    draft.durationMinutes = duration;
    draft.matched.push(duration >= 60 ? `${Math.floor(duration / 60)}\u5C0F\u65F6\u4F59` : `${duration}\u5206\u949F`);
  }
  const unknowns = [];
  if (!draft.task) unknowns.push("\u5B66\u4E60\u4EFB\u52A1");
  if (draft.durationMinutes === void 0) unknowns.push("\u5B66\u4E60\u65F6\u957F");
  if (draft.energy === void 0) unknowns.push("\u7CBE\u529B\u6C34\u5E73");
  if (draft.stress === void 0) unknowns.push("\u538B\u529B\u6C34\u5E73");
  if (draft.focusDifficulty === void 0) unknowns.push("\u4E13\u6CE8\u96BE\u5EA6");
  if (draft.moods.length === 0) unknowns.push("\u60C5\u7EEA");
  if (!draft.prefs.calmness && !draft.prefs.vocalPreference && (draft.prefs.genres?.length ?? 0) === 0) {
    unknowns.push("\u97F3\u4E50\u504F\u597D");
  }
  const aspects = [
    draft.task !== void 0,
    draft.durationMinutes !== void 0,
    draft.energy !== void 0,
    draft.stress !== void 0,
    draft.focusDifficulty !== void 0,
    draft.moods.length > 0,
    draft.prefs.calmness !== void 0,
    draft.prefs.vocalPreference !== void 0,
    (draft.prefs.genres?.length ?? 0) > 0
  ];
  const captured = aspects.filter(Boolean).length;
  const confidence = Math.min(0.95, 0.15 + captured * 0.12);
  const context = {
    task: draft.task,
    durationMinutes: draft.durationMinutes,
    energy: draft.energy,
    stress: draft.stress,
    focusDifficulty: draft.focusDifficulty,
    moods: draft.moods,
    musicPrefs: draft.prefs,
    rawInput: input,
    parserMeta: {
      parser: "rules",
      confidence,
      matched: draft.matched,
      unknowns
    }
  };
  return { context };
}
function pushMood(d, mood) {
  if (!d.moods.includes(mood)) d.moods.push(mood);
}
function pushGenre(d, genre) {
  d.prefs.genres = d.prefs.genres ?? [];
  if (!d.prefs.genres.includes(genre)) d.prefs.genres.push(genre);
}
function pushLang(d, lang) {
  d.prefs.languages = d.prefs.languages ?? [];
  if (!d.prefs.languages.includes(lang)) d.prefs.languages.push(lang);
}

// src/core/recommend/priors.ts
var GENRE_ENERGY_PRIOR = {
  ambient: 0.15,
  piano: 0.25,
  classical: 0.3,
  lofi: 0.3,
  acoustic: 0.4,
  folk: 0.4,
  soundtrack: 0.4,
  jazz: 0.45,
  "post-rock": 0.45,
  rnb: 0.5,
  "city-pop": 0.55,
  pop: 0.6,
  acg: 0.6,
  electronic: 0.7,
  hiphop: 0.7,
  rock: 0.75,
  metal: 0.9
};
var MOOD_DIRECTION = {
  tired: ["focus", "calm", "dreamy"],
  anxious: ["calm", "soothing", "warm"],
  irritable: ["calm", "focus"],
  down: ["uplifting", "warm", "gentle"],
  bored: ["uplifting", "groovy"],
  happy: ["uplifting", "bright"],
  lonely: ["warm", "gentle"],
  calm: ["calm", "focus"]
};
var CONTEXT_MOOD_TO_DESIRED = {
  tired: "tired",
  anxious: "anxious",
  irritable: "irritable",
  down: "down",
  bored: "bored",
  happy: "happy",
  lonely: "lonely",
  calm: "calm"
};

// src/core/personalization/affinity.ts
var FEEDBACK_WEIGHT = {
  like: 1,
  skip: -0.4,
  not_suitable: -1
};
var HALF_LIFE_MS = 60 * 24 * 60 * 60 * 1e3;
function computeAffinity(events, artistOfTrack, now = /* @__PURE__ */ new Date(), relevance) {
  const track = /* @__PURE__ */ new Map();
  const artist = /* @__PURE__ */ new Map();
  for (const event of events) {
    const base = FEEDBACK_WEIGHT[event.type];
    const ageMs = now.getTime() - new Date(event.createdAt).getTime();
    const decay = Math.pow(0.5, Math.max(0, ageMs) / HALF_LIFE_MS);
    const scale = relevance ? relevance(event) : 1;
    const weight = base * decay * scale;
    track.set(event.trackId, (track.get(event.trackId) ?? 0) + weight);
    const artistName = artistOfTrack.get(event.trackId);
    if (artistName !== void 0) {
      artist.set(artistName, (artist.get(artistName) ?? 0) + weight * 0.5);
    }
  }
  return { track, artist, artistOfTrack };
}
function affinityToScore(sum) {
  return 0.5 + 0.5 * Math.tanh(sum / 1.5);
}

// src/core/recommend/engine.ts
var DEFAULT_ENGINE_CONFIG = {
  weights: {
    context: 0.36,
    vocal: 0.18,
    mood: 0.14,
    preference: 0.14,
    personal: 0.12,
    freshness: 0.06
  },
  /** 正向（喜欢）个性化偏差上限（百分制分值）：喜欢不应强行把歌顶上去 */
  personalCap: 8,
  /** 负向（不适合/跳过）偏差上限：必须可靠地把被拒曲目压下去 */
  personalNegativeCap: 20
};
var MOOD_TAG_ZH = {
  focus: "\u4E13\u6CE8",
  calm: "\u5E73\u9759",
  uplifting: "\u632F\u594B",
  warm: "\u6E29\u6696",
  dreamy: "\u68A6\u5E7B",
  soothing: "\u629A\u6170",
  gentle: "\u67D4\u548C",
  groovy: "\u5F8B\u52A8",
  bright: "\u660E\u4EAE",
  melancholic: "\u5FE7\u90C1"
};
var GENRE_ZH = {
  lofi: "Lo-Fi",
  classical: "\u53E4\u5178",
  piano: "\u94A2\u7434",
  "post-rock": "\u540E\u6447",
  electronic: "\u7535\u5B50",
  jazz: "\u7235\u58EB",
  folk: "\u6C11\u8C23",
  rock: "\u6447\u6EDA",
  pop: "\u6D41\u884C",
  "city-pop": "City Pop",
  acg: "ACG",
  ambient: "\u6C1B\u56F4",
  acoustic: "\u539F\u58F0",
  rnb: "R&B",
  hiphop: "\u563B\u54C8",
  soundtrack: "\u5F71\u89C6\u539F\u58F0",
  metal: "\u91D1\u5C5E"
};
var LANG_ZH = {
  zh: "\u4E2D\u6587",
  en: "\u82F1\u6587",
  ja: "\u65E5\u8BED",
  ko: "\u97E9\u8BED",
  instrumental: "\u7EAF\u97F3\u4E50"
};
function energyWord(v) {
  if (v < 0.33) return "\u5B89\u9759\u8212\u7F13";
  if (v < 0.66) return "\u5F20\u5F1B\u9002\u4E2D";
  return "\u63D0\u795E\u5E26\u611F";
}
function trackEnergy(track) {
  if (track.energy !== void 0) return track.energy;
  const genres = track.genres ?? [];
  const priors = genres.map((g) => GENRE_ENERGY_PRIOR[g]).filter((v) => v !== void 0);
  if (priors.length > 0) return priors.reduce((a, b) => a + b, 0) / priors.length;
  return 0.5;
}
function deriveTargetProfile(context) {
  const prefs = context.musicPrefs ?? {};
  let targetEnergy;
  let energyDefault;
  let energyReason;
  if (prefs.calmness === "calm") {
    targetEnergy = 0.25;
    energyDefault = "stated";
    energyReason = "\u4F60\u660E\u786E\u60F3\u8981\u5B89\u9759\u7684\u97F3\u4E50";
  } else if (prefs.calmness === "energetic") {
    targetEnergy = 0.75;
    energyDefault = "stated";
    energyReason = "\u4F60\u660E\u786E\u60F3\u8981\u63D0\u795E\u7684\u97F3\u4E50";
  } else if (prefs.calmness === "balanced") {
    targetEnergy = 0.5;
    energyDefault = "stated";
    energyReason = "\u4F60\u60F3\u8981\u5F20\u5F1B\u9002\u4E2D\u7684\u97F3\u4E50";
  } else if (context.focusDifficulty === "high") {
    targetEnergy = 0.35;
    energyDefault = "inferred";
    energyReason = "\u4F60\u63D0\u5230\u5BB9\u6613\u8D70\u795E\uFF0C\u503E\u5411\u66F4\u5B89\u9759\u3001\u66F4\u5C11\u5E72\u6270\u7684\u66F2\u76EE";
  } else if (context.energy === "low") {
    targetEnergy = 0.45;
    energyDefault = "inferred";
    energyReason = "\u4F60\u73B0\u5728\u6BD4\u8F83\u7D2F\uFF0C\u9009\u4E86\u6E29\u548C\u4E0D\u5435\u7684\u66F2\u76EE";
  } else if (context.energy === "high") {
    targetEnergy = 0.65;
    energyDefault = "inferred";
    energyReason = "\u4F60\u73B0\u5728\u7CBE\u529B\u5145\u6C9B\uFF0C\u53EF\u4EE5\u9A7E\u9A6D\u66F4\u6709\u6D3B\u529B\u7684\u66F2\u76EE";
  } else if (context.stress === "high") {
    targetEnergy = 0.4;
    energyDefault = "inferred";
    energyReason = "\u4F60\u6709\u538B\u529B\uFF0C\u503E\u5411\u5E73\u7A33\u653E\u677E\u7684\u66F2\u76EE";
  } else {
    targetEnergy = 0.5;
    energyDefault = "default";
    energyReason = "\u672A\u7279\u522B\u8BF4\u660E\uFF0C\u91C7\u7528\u5F20\u5F1B\u9002\u4E2D\u7684\u9ED8\u8BA4\u53D6\u5411";
  }
  if (energyDefault === "stated") {
    if (context.focusDifficulty === "high") targetEnergy -= 0.04;
    if (context.stress === "high") targetEnergy -= 0.04;
    if (context.energy === "high") targetEnergy += 0.04;
  }
  let targetVocal;
  let vocalDefault;
  if (prefs.vocalPreference !== void 0) {
    targetVocal = prefs.vocalPreference;
    vocalDefault = "stated";
  } else if (context.focusDifficulty === "high") {
    targetVocal = "few-lyrics";
    vocalDefault = "inferred";
  } else {
    targetVocal = "any";
    vocalDefault = "default";
  }
  const desiredMoodSet = /* @__PURE__ */ new Set();
  for (const mood of context.moods ?? []) {
    const key = CONTEXT_MOOD_TO_DESIRED[mood];
    if (key === void 0) continue;
    for (const d of MOOD_DIRECTION[key] ?? []) desiredMoodSet.add(d);
  }
  if (desiredMoodSet.size === 0) {
    desiredMoodSet.add("focus");
    desiredMoodSet.add("calm");
  }
  return {
    targetEnergy: Math.min(1, Math.max(0, targetEnergy)),
    targetVocal,
    desiredMoods: [...desiredMoodSet],
    defaults: { energy: energyDefault, vocal: vocalDefault },
    energyReason
  };
}
function vocalScore(track, targetVocal) {
  if (targetVocal === "any") return 0.5;
  const density = track.isInstrumental || track.vocalDensity === "none" ? "none" : track.vocalDensity ?? "medium";
  switch (density) {
    case "none":
      return 1;
    case "low":
      return targetVocal === "instrumental" ? 0.75 : 1;
    case "medium":
      return targetVocal === "instrumental" ? 0.25 : 0.6;
    case "high":
      return targetVocal === "instrumental" ? 0.05 : 0.2;
  }
}
function moodScore(track, desiredMoods) {
  const tags = track.moodTags ?? [];
  const matched = tags.filter((t) => desiredMoods.includes(t));
  if (matched.length === 0) {
    return { score: tags.length === 0 ? 0.35 : 0.2, matched: [] };
  }
  return { score: Math.min(1, 0.6 + 0.4 * (matched.length / desiredMoods.length)), matched };
}
function preferenceScore(track, context) {
  const prefs = context.musicPrefs ?? {};
  const parts = [];
  if (prefs.genres && prefs.genres.length > 0) {
    const trackGenres = track.genres ?? [];
    const matchedGenres2 = prefs.genres.filter((g) => trackGenres.includes(g));
    parts.push({
      score: matchedGenres2.length > 0 ? 1 : 0.35,
      note: matchedGenres2.length > 0 ? "genre" : void 0
    });
  }
  if (prefs.languages && prefs.languages.length > 0) {
    const matchedLangs2 = track.language !== void 0 ? prefs.languages.filter((l) => l === track.language) : [];
    parts.push({ score: matchedLangs2.length > 0 ? 1 : track.isInstrumental ? 0.7 : 0.4 });
  }
  if (parts.length === 0) return { score: 0.5, matchedGenres: [], matchedLangs: [] };
  const score = parts.reduce((sum, p) => sum + p.score, 0) / parts.length;
  const matchedGenres = parts.some((p) => p.note === "genre") && prefs.genres ? prefs.genres.filter((g) => (track.genres ?? []).includes(g)) : [];
  const matchedLangs = track.language !== void 0 && (prefs.languages ?? []).includes(track.language) ? [track.language] : [];
  return { score, matchedGenres, matchedLangs };
}
function personalScore(track, affinity) {
  const trackSum = affinity.track.get(track.id) ?? 0;
  const artistSum = track.artist ? affinity.artist.get(track.artist) ?? 0 : 0;
  const score = 0.7 * affinityToScore(trackSum) + 0.3 * affinityToScore(artistSum);
  return { score, trackSum, artistSum };
}
function buildReasons(args) {
  const { track, profile, components, moodMatched, matchedGenres, matchedLangs, personal } = args;
  const reasons = [];
  const contextComp = components.find((c) => c.key === "context");
  if (contextComp && Math.abs(contextComp.score - 0.5) > 0.08) {
    reasons.push(
      `\u66F2\u76EE${energyWord(trackEnergy(track))}\uFF0C${profile.energyReason}`
    );
  }
  const vocalComp = components.find((c) => c.key === "vocal");
  if (vocalComp && profile.targetVocal !== "any") {
    if (track.isInstrumental || track.vocalDensity === "none") {
      reasons.push("\u7EAF\u97F3\u4E50\u6CA1\u6709\u4EBA\u58F0\uFF0C\u4E0D\u4F1A\u62A2\u8D70\u6CE8\u610F\u529B");
    } else if (vocalComp.score >= 0.6) {
      reasons.push("\u4EBA\u58F0\u8F7B\u3001\u6B4C\u8BCD\u5C11\uFF0C\u9002\u5408\u9700\u8981\u4E13\u6CE8\u7684\u65F6\u5019");
    }
  }
  if (moodMatched.length > 0) {
    const zh = moodMatched.map((m) => MOOD_TAG_ZH[m] ?? m).join("\u3001");
    reasons.push(`\u66F2\u98CE\u60C5\u7EEA\u504F\u300C${zh}\u300D\uFF0C\u5951\u5408\u4F60\u73B0\u5728\u7684\u72B6\u6001`);
  }
  if (matchedGenres.length > 0) {
    const zh = matchedGenres.map((g) => GENRE_ZH[g] ?? g).join("\u3001");
    reasons.push(`\u7B26\u5408\u4F60\u70B9\u540D\u7684\u300C${zh}\u300D\u98CE\u683C`);
  }
  if (matchedLangs.length > 0) {
    const zh = matchedLangs.map((l) => LANG_ZH[l] ?? l).join("\u3001");
    reasons.push(`\u662F${zh}\u6B4C\u66F2\uFF0C\u7B26\u5408\u4F60\u7684\u504F\u597D`);
  }
  if (personal.trackSum > 0.5) {
    reasons.push("\u4F60\u4E4B\u524D\u559C\u6B22\u8FC7\u8FD9\u9996\u6B4C");
  } else if (personal.artistSum > 0.5) {
    reasons.push(`\u4F60\u53CD\u9988\u8FC7\u4E0D\u9519\uFF0C${track.artist} \u7684\u4F5C\u54C1\u9002\u5408\u4F60`);
  } else if (personal.trackSum < -0.5) {
    reasons.push("\u4F60\u4E4B\u524D\u8DF3\u8FC7/\u6807\u8BB0\u8FC7\u4E0D\u9002\u5408\uFF0C\u5DF2\u660E\u663E\u964D\u6743");
  }
  const freshComp = components.find((c) => c.key === "freshness");
  if (freshComp && freshComp.score < 1) {
    reasons.push("\u6700\u8FD1\u521A\u63A8\u8350\u8FC7\uFF0C\u8FD9\u6B21\u7A0D\u5FAE\u9760\u540E");
  }
  return reasons;
}
function recommend(input) {
  const {
    tracks,
    context,
    feedbackEvents,
    recentTrackIds = [],
    excludeTrackIds = [],
    limit = 10,
    config = DEFAULT_ENGINE_CONFIG,
    now = /* @__PURE__ */ new Date()
  } = input;
  if (tracks.length === 0) return [];
  const profile = deriveTargetProfile(context);
  const artistOfTrack = new Map(tracks.map((t) => [t.id, t.artist]));
  const relevance = (event) => {
    const snapTask = event.contextSnapshot?.task;
    if (snapTask === void 0 || context.task === void 0) return 0.7;
    return snapTask === context.task ? 1 : 0.45;
  };
  const affinity = computeAffinity(feedbackEvents, artistOfTrack, now, relevance);
  const excluded = new Set(excludeTrackIds);
  const recent = new Set(recentTrackIds);
  const scored = tracks.filter((t) => !excluded.has(t.id)).map((track) => {
    const energy = trackEnergy(track);
    const contextScore = 1 - Math.abs(energy - profile.targetEnergy);
    const vScore = vocalScore(track, profile.targetVocal);
    const { score: mScore, matched: moodMatched } = moodScore(track, profile.desiredMoods);
    const { score: pScore, matchedGenres, matchedLangs } = preferenceScore(track, context);
    const personal = personalScore(track, affinity);
    const freshScore = recent.has(track.id) ? 0.35 : 1;
    const components = [
      { key: "context", score: contextScore, weight: config.weights.context, reason: "" },
      { key: "vocal", score: vScore, weight: config.weights.vocal, reason: "" },
      { key: "mood", score: mScore, weight: config.weights.mood, reason: "" },
      { key: "preference", score: pScore, weight: config.weights.preference, reason: "" },
      { key: "personal", score: personal.score, weight: config.weights.personal, reason: "" },
      { key: "freshness", score: freshScore, weight: config.weights.freshness, reason: "" }
    ];
    let total = 0;
    for (const comp of components) {
      let contribution = comp.score * comp.weight * 100;
      if (comp.key === "personal") {
        const deviation = (comp.score - 0.5) * comp.weight * 100;
        const cap = deviation >= 0 ? config.personalCap : config.personalNegativeCap;
        const capped = Math.max(-cap, Math.min(cap, deviation));
        contribution = 0.5 * comp.weight * 100 + capped;
      }
      total += contribution;
    }
    const score = Math.round(Math.min(100, Math.max(0, total)) * 10) / 10;
    const reasons = buildReasons({
      track,
      profile,
      context,
      components,
      moodMatched,
      matchedGenres,
      matchedLangs,
      personal
    });
    return { track, score, components, reasons };
  }).sort((a, b) => b.score - a.score);
  const perArtist = /* @__PURE__ */ new Map();
  const results = [];
  const durationTieBreak = (track) => {
    const d = track.durationSec;
    if (d >= 150 && d <= 420) return 1;
    if (d < 150) return d / 150;
    return Math.max(0, 1 - (d - 420) / 600);
  };
  const sortedForSelection = [...scored].sort(
    (a, b) => b.score - a.score || durationTieBreak(b.track) - durationTieBreak(a.track) || a.track.title.localeCompare(b.track.title)
  );
  for (const item of sortedForSelection) {
    const count = perArtist.get(item.track.artist) ?? 0;
    if (count >= 2) continue;
    perArtist.set(item.track.artist, count + 1);
    results.push({ track: item.track, score: item.score, components: item.components, reasons: item.reasons });
    if (results.length >= limit) break;
  }
  return results;
}

// src/core/recommend/playlist.ts
var DEFAULT_PLAYLIST_BUDGET_MIN = 30;
var OVERSHOOT_TOLERANCE_SEC = 90;
function buildPlaylist(ranked, budgetMin = DEFAULT_PLAYLIST_BUDGET_MIN) {
  const budget = Math.max(5, Math.min(240, budgetMin)) * 60;
  const picked = [];
  let totalSec = 0;
  for (const rec of ranked) {
    const dur = rec.track.durationSec;
    if (totalSec + dur <= budget + OVERSHOOT_TOLERANCE_SEC) {
      picked.push(rec);
      totalSec += dur;
    }
    if (totalSec >= budget) break;
  }
  return {
    tracks: picked,
    totalSec,
    budgetMin: Math.round(budget / 60),
    shortfallSec: Math.max(0, budget - totalSec)
  };
}

// src/core/learn/featureLearner.ts
var ENERGY_LEARNING_RATE = 0.3;
var RULES = [
  // 提神 / 给力
  { pattern: /(有力气|给力|提神|醒脑|振奋|带劲|带感|有劲|燃|来劲|精神了起来|提高精力|精力提高|充满能量|energetic)/i, energy: "high", moodTags: ["uplifting", "bright"] },
  { pattern: /(节奏感|动感|想跟着抖腿|律动)/, energy: "high", moodTags: ["groovy"] },
  // 平静 / 放松
  { pattern: /(安静|舒缓|平静|放松|轻柔|柔和|治愈|静心|心静|放松下来)/, energy: "low", moodTags: ["calm", "soothing"] },
  { pattern: /(催眠|想睡|睡前|入眠)/, energy: "low", moodTags: ["dreamy", "calm"] },
  // 专注
  { pattern: /(专注|专心|学习的时候|写代码的时候|工作的时候|进入状态|心流)/, moodTags: ["focus"] },
  // 情绪
  { pattern: /(开心|快乐|愉快|心情好|阳光)/, moodTags: ["bright", "warm"] },
  { pattern: /(难过|伤心|emo|伤感|忧郁|低落)/i, moodTags: ["melancholic"] },
  { pattern: /(温暖|温柔|暖)/, moodTags: ["warm", "gentle"] },
  { pattern: /(梦幻|缥缈|空灵|恍惚)/, moodTags: ["dreamy"] },
  // 人声
  { pattern: /(没有?人声|没有?歌词|纯音乐|instrumental)/i, vocalDensity: "none" },
  { pattern: /(歌词少|人声少|少唱)/, vocalDensity: "low" }
];
function parseSongFeedback(text) {
  const clean = text.trim();
  const delta = { moodTags: [], matched: [], understood: false };
  if (clean === "") return delta;
  for (const rule of RULES) {
    const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const hit of clean.matchAll(globalPattern)) {
      delta.matched.push(hit[0] ?? "");
      if (rule.energy !== void 0 && delta.energyHint === void 0) {
        delta.energyHint = rule.energy;
      }
      for (const tag of rule.moodTags ?? []) {
        if (!delta.moodTags.includes(tag)) delta.moodTags.push(tag);
      }
      if (rule.vocalDensity !== void 0 && delta.vocalDensity === void 0) {
        delta.vocalDensity = rule.vocalDensity;
      }
    }
  }
  delta.understood = delta.matched.length > 0;
  return delta;
}
var ENERGY_TARGET = {
  low: 0.28,
  medium: 0.5,
  high: 0.72
};
function applyFeatureDelta(track, delta) {
  const next = { ...track, moodTags: [...track.moodTags ?? []], genres: [...track.genres ?? []] };
  const moodTags = next.moodTags;
  const changes = [];
  if (delta.energyHint !== void 0) {
    const target = ENERGY_TARGET[delta.energyHint];
    const old = next.energy ?? 0.5;
    const blended = old * (1 - ENERGY_LEARNING_RATE) + target * ENERGY_LEARNING_RATE;
    next.energy = Math.round(blended * 100) / 100;
    const direction = next.energy > old ? "\u63D0\u5347" : next.energy < old ? "\u964D\u4F4E" : "\u7EF4\u6301";
    changes.push(`\u80FD\u91CF ${old.toFixed(2)} \u2192 ${next.energy.toFixed(2)}\uFF08${direction}\uFF09`);
  }
  for (const tag of delta.moodTags) {
    if (!moodTags.includes(tag)) {
      if (moodTags.length < 6) {
        moodTags.push(tag);
        changes.push(`\u65B0\u589E\u60C5\u7EEA\u6807\u7B7E\u300C${tag}\u300D`);
      }
    }
  }
  if (delta.vocalDensity !== void 0 && next.vocalDensity !== delta.vocalDensity) {
    next.vocalDensity = delta.vocalDensity;
    changes.push(`\u4EBA\u58F0\u5BC6\u5EA6 \u2192 ${delta.vocalDensity}`);
  }
  return { track: next, changes, delta };
}

// src/core/native/nowPlaying.ts
var import_node_child_process = require("node:child_process");
var SOURCE_MARKERS = [
  { marker: "\u7F51\u6613\u4E91\u97F3\u4E50", source: "netease" },
  { marker: "CloudMusic", source: "netease" },
  { marker: "QQ\u97F3\u4E50", source: "qq" },
  { marker: "QQMusic", source: "qq" }
];
function parseWindowTitle(raw2) {
  const text = raw2.trim();
  if (text === "") return null;
  const source = SOURCE_MARKERS.find((m) => text.includes(m.marker))?.source;
  if (source === void 0) return null;
  let cleaned = text;
  for (const m of SOURCE_MARKERS) {
    cleaned = cleaned.replace(new RegExp(`[-\u2014|]*\\s*${m.marker}\\s*$`), "");
  }
  const parts = cleaned.split(/\s+-\s+|\s+—\s+/).map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) return null;
  const title = parts[0];
  if (title === void 0 || title === "") return null;
  if (/^(网易云音乐|CloudMusic|QQ音乐)$/.test(title)) return null;
  return {
    playing: true,
    title,
    artist: parts[1],
    source,
    rawTitle: text
  };
}
function listWindowTitles() {
  return new Promise((resolve) => {
    const script = "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { $_.MainWindowTitle }";
    (0, import_node_child_process.execFile)(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5e3, windowsHide: true, encoding: "utf8" },
      (err, stdout) => {
        if (err !== null || stdout === void 0) {
          resolve([]);
          return;
        }
        resolve(stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== ""));
      }
    );
  });
}
async function detectNowPlaying() {
  const titles = await listWindowTitles();
  for (const title of titles) {
    const parsed = parseWindowTitle(title);
    if (parsed !== null) return parsed;
  }
  return { playing: false };
}

// src/core/import/validate.ts
function validateImportRows(rows, options = {}) {
  const result = { accepted: [], rejected: [] };
  if (!Array.isArray(rows)) {
    result.rejected.push({ row: -1, reason: "\u5BFC\u5165\u5185\u5BB9\u5FC5\u987B\u662F\u6570\u7EC4" });
    return result;
  }
  const existing = options.existingIds ?? /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set();
  rows.forEach((row, index) => {
    try {
      if (typeof row !== "object" || row === null) throw new Error("\u4E0D\u662F\u5BF9\u8C61");
      const r = row;
      const title = str(r.title ?? r.name ?? r.\u6B4C\u540D);
      if (!title) throw new Error("\u7F3A\u5C11\u6B4C\u540D title");
      const artist = str(r.artist ?? r.singer ?? r.artists ?? r.\u6B4C\u624B);
      if (!artist) throw new Error("\u7F3A\u5C11\u6B4C\u624B artist");
      const durationSec = parseDuration(r.durationSec ?? r.duration ?? r["\u65F6\u957F"]);
      if (durationSec === void 0 || durationSec <= 0 || durationSec > 3600) {
        throw new Error("\u65F6\u957F durationSec \u65E0\u6548");
      }
      const id = str(r.id) || slugify(`${title}-${artist}`);
      if (seen.has(id) || existing.has(id)) throw new Error(`id \u91CD\u590D: ${id}`);
      seen.add(id);
      const energyRaw = num(r.energy);
      const track = {
        id,
        title,
        artist: Array.isArray(r.artists) ? artist : artist,
        album: str(r.album) || void 0,
        durationSec,
        language: str(r.language ?? r.lang) || void 0,
        isInstrumental: bool(r.isInstrumental) || str(r.language) === "instrumental",
        genres: strArray(r.genres ?? r.genre ?? r.tags),
        energy: energyRaw === void 0 ? void 0 : clamp(energyRaw, 0, 1),
        moodTags: strArray(r.moodTags ?? r.moods),
        vocalDensity: parseVocalDensity(r.vocalDensity),
        source: options.source ?? { kind: "json", importedAt: (/* @__PURE__ */ new Date()).toISOString() },
        netease: {
          songId: intOrNull(r.neteaseSongId ?? r.netease?.songId),
          searchKeyword: str(r.neteaseSearchKeyword) || `${title} ${artist}`
        }
      };
      result.accepted.push(track);
    } catch (err) {
      result.rejected.push({ row: index, reason: err.message });
    }
  });
  return result;
}
function str(v) {
  return typeof v === "string" ? v.trim() : "";
}
function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return void 0;
}
function intOrNull(v) {
  const n = num(v);
  return n === void 0 || !Number.isInteger(n) ? void 0 : n;
}
function bool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}
function strArray(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  if (typeof v === "string") {
    return v.split(/[,，;；/|]/).map((s) => s.trim()).filter((s) => s !== "");
  }
  return [];
}
function parseVocalDensity(v) {
  const s = str(v).toLowerCase();
  if (["none", "low", "medium", "high"].includes(s)) return s;
  return void 0;
}
function parseDuration(v) {
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2}):([0-5]?\d)$/);
    if (m && m[1] !== void 0 && m[2] !== void 0) return Number(m[1]) * 60 + Number(m[2]);
  }
  return num(v);
}
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
function slugify(text) {
  const base = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "");
  return base || `track-${Date.now().toString(36)}`;
}

// src/core/import/csv.ts
var HEADER_ALIASES = {
  title: ["title", "name", "song", "track", "\u6B4C\u540D", "\u6B4C\u66F2", "\u6807\u9898", "\u66F2\u540D"],
  artist: ["artist", "singer", "artists", "\u6B4C\u624B", "\u827A\u672F\u5BB6", "\u6F14\u5531\u8005", "\u4F5C\u8005"],
  album: ["album", "\u4E13\u8F91", "\u5531\u7247"],
  durationSec: ["durationsec", "duration", "length", "\u65F6\u957F", "\u957F\u5EA6", "\u65F6\u95F4"],
  language: ["language", "lang", "\u8BED\u8A00"],
  isInstrumental: ["isinstrumental", "instrumental", "\u7EAF\u97F3\u4E50", "\u65E0\u4EBA\u58F0"],
  genres: ["genres", "genre", "tags", "tag", "\u98CE\u683C", "\u6D41\u6D3E", "\u6807\u7B7E"],
  energy: ["energy", "\u80FD\u91CF"],
  moodTags: ["moodtags", "moods", "mood", "\u60C5\u7EEA", "\u60C5\u7EEA\u6807\u7B7E"],
  vocalDensity: ["vocaldensity", "vocals", "\u4EBA\u58F0\u5BC6\u5EA6", "\u4EBA\u58F0"]
};
function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}
function normalizeHeader(text) {
  const key = text.trim().toLowerCase().replace(/\s+/g, "");
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => a.toLowerCase() === key)) return field;
  }
  return void 0;
}
function importCsv(text, options = {}) {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { accepted: [], rejected: [{ row: -1, reason: "CSV \u5185\u5BB9\u4E3A\u7A7A" }] };
  }
  const header = table[0] ?? [];
  const columns = header.map(normalizeHeader);
  if (!columns.includes("title") || !columns.includes("artist")) {
    return {
      accepted: [],
      rejected: [{ row: 0, reason: "\u8868\u5934\u9700\u5305\u542B\u300C\u6B4C\u540D/title\u300D\u548C\u300C\u6B4C\u624B/artist\u300D\u5217" }]
    };
  }
  const rows = table.slice(1).map((cells) => {
    const obj = {};
    columns.forEach((col, i) => {
      if (col === void 0) return;
      const value = cells[i] ?? "";
      if (["genres", "moodTags"].includes(col)) {
        obj[col] = value;
      } else if (col === "isInstrumental") {
        obj[col] = /^(1|true|yes|y|是|纯音乐)$/i.test(value.trim());
      } else {
        obj[col] = value === "" ? void 0 : value;
      }
    });
    return obj;
  });
  return validateImportRows(rows, options);
}

// src/sample/sampleLibrary.ts
var ROWS = [
  // ---------- 钢琴 / 古典（安静纯音乐） ----------
  ["river-flows-in-you", "River Flows in You", "\uC774\uB8E8\uB9C8", "First Love", 188, "instrumental", true, ["piano", "classical"], 0.2, ["calm", "dreamy"], "none"],
  ["kiss-the-rain", "Kiss the Rain", "\uC774\uB8E8\uB9C8", "From The Yellow Room", 256, "instrumental", true, ["piano"], 0.2, ["calm", "soothing"], "none"],
  ["canon-in-d", "Canon in D", "Johann Pachelbel", void 0, 300, "instrumental", true, ["classical"], 0.3, ["calm", "bright"], "none"],
  ["clair-de-lune", "Clair de Lune", "Claude Debussy", void 0, 305, "instrumental", true, ["classical", "piano"], 0.2, ["calm", "dreamy"], "none"],
  ["nocturne-op9-2", "Nocturne No. 2 Op. 9", "Fr\xE9d\xE9ric Chopin", void 0, 270, "instrumental", true, ["classical", "piano"], 0.25, ["calm", "warm"], "none"],
  ["gymnopedie-no1", "Gymnop\xE9die No. 1", "Erik Satie", void 0, 180, "instrumental", true, ["classical", "piano"], 0.15, ["calm", "dreamy"], "none"],
  ["nuvole-bianche", "Nuvole Bianche", "Ludovico Einaudi", "Una Mattina", 357, "instrumental", true, ["piano", "classical"], 0.3, ["calm", "focus"], "none"],
  ["experience", "Experience", "Ludovico Einaudi", "In A Time Lapse", 312, "instrumental", true, ["piano", "classical"], 0.45, ["uplifting", "focus"], "none"],
  ["summer-kikujiro", "Summer", "\u4E45\u77F3\u8B72", "\u83CA\u6B21\u90CE\u306E\u590F", 196, "instrumental", true, ["piano", "soundtrack"], 0.4, ["bright", "uplifting"], "none"],
  ["the-rain", "The Rain", "\u4E45\u77F3\u8B72", "\u83CA\u6B21\u90CE\u306E\u590F", 336, "instrumental", true, ["piano", "soundtrack"], 0.3, ["calm", "melancholic"], "none"],
  ["merry-go-round", "\u4EBA\u751F\u306E\u30E1\u30EA\u30FC\u30B4\u30FC\u30E9\u30F3\u30C9", "\u4E45\u77F3\u8B72", "\u30CF\u30A6\u30EB\u306E\u52D5\u304F\u57CE", 131, "instrumental", true, ["soundtrack", "classical"], 0.35, ["dreamy", "gentle"], "none"],
  ["comptine", "Comptine d'un autre \xE9t\xE9", "Yann Tiersen", "Am\xE9lie", 140, "instrumental", true, ["piano"], 0.25, ["melancholic", "calm"], "none"],
  ["la-valse-damelie", "La Valse d'Am\xE9lie", "Yann Tiersen", "Am\xE9lie", 135, "instrumental", true, ["piano"], 0.3, ["dreamy", "gentle"], "none"],
  ["avril-14th", "Avril 14th", "Aphex Twin", "Drukqs", 125, "instrumental", true, ["piano", "ambient"], 0.2, ["calm", "dreamy"], "none"],
  ["merry-christmas-mr-lawrence", "Merry Christmas Mr. Lawrence", "\u5742\u672C\u9F8D\u4E00", void 0, 420, "instrumental", true, ["piano", "classical"], 0.25, ["melancholic", "calm"], "none"],
  ["on-the-nature-of-daylight", "On the Nature of Daylight", "Max Richter", "The Blue Notebooks", 360, "instrumental", true, ["classical", "soundtrack"], 0.25, ["melancholic", "calm", "soothing"], "none"],
  ["near-light", "Near Light", "\xD3lafur Arnalds", "For Now I Am Winter", 250, "instrumental", true, ["piano", "classical"], 0.3, ["calm", "focus"], "none"],
  ["huan-qin", "\u6B22\u6C81", "\u6797\u6D77", "\u7435\u7436\u76F8", 220, "instrumental", true, ["classical"], 0.3, ["bright", "gentle"], "none"],
  // ---------- Lo-Fi / Chillhop（专注伴奏） ----------
  ["snowman", "Snowman", "WYS", void 0, 146, "instrumental", true, ["lofi"], 0.25, ["calm", "dreamy"], "none"],
  ["frostbite", "Frostbite", "Purrple Cat", void 0, 200, "instrumental", true, ["lofi"], 0.25, ["calm", "dreamy"], "none"],
  ["cinnamon", "Cinnamon", "Sleepermane", void 0, 180, "instrumental", true, ["lofi"], 0.3, ["calm", "focus"], "none"],
  ["affection", "Affection", "Jinsang", void 0, 150, "instrumental", true, ["lofi"], 0.25, ["calm", "warm"], "none"],
  ["aruarian-dance", "Aruarian Dance", "Nujabes", "Samurai Champloo Music Record", 263, "instrumental", true, ["lofi", "hiphop"], 0.3, ["calm", "groovy", "focus"], "none"],
  ["feather", "Feather", "Nujabes", "Modal Soul", 270, "instrumental", true, ["lofi", "hiphop"], 0.35, ["focus", "groovy"], "none"],
  ["luv-sic-part3", "Luv(sic) Part 3", "Nujabes", void 0, 290, "en", false, ["lofi", "hiphop"], 0.4, ["focus", "groovy"], "low"],
  ["dont-cry-dilla", "Don't Cry", "J Dilla", "Donuts", 120, "instrumental", true, ["hiphop", "lofi"], 0.3, ["gentle", "melancholic"], "none"],
  // ---------- 后摇 / 氛围电子（长段专注） ----------
  ["your-hand-in-mine", "Your Hand in Mine", "Explosions in the Sky", "The Earth Is Not a Cold Dead Place", 480, "instrumental", true, ["post-rock"], 0.5, ["uplifting", "focus"], "none"],
  ["ashes-in-the-snow", "Ashes in the Snow", "MONO", "Hymn to the Immortal Wind", 400, "instrumental", true, ["post-rock"], 0.45, ["melancholic", "dreamy"], "none"],
  ["hai-yang-zhi-xin", "\u6D77\u6D0B\u4E4B\u5FC3", "\u60D8\u95FB", "\u5C81\u6708\u9E3F\u6C9F", 520, "instrumental", true, ["post-rock"], 0.5, ["focus", "dreamy"], "none"],
  ["goodbye-toe", "Goodbye", "toe", "For Long Tomorrow", 270, "instrumental", true, ["post-rock"], 0.5, ["groovy", "focus"], "none"],
  ["a-walk", "A Walk", "Tycho", "Dive", 330, "instrumental", true, ["electronic", "ambient"], 0.4, ["calm", "focus"], "none"],
  ["awake", "Awake", "Tycho", "Awake", 290, "instrumental", true, ["electronic"], 0.5, ["uplifting", "focus"], "none"],
  ["kerala", "Kerala", "Bonobo", "Migration", 247, "instrumental", true, ["electronic"], 0.5, ["groovy", "focus"], "none"],
  ["emerald-rush", "Emerald Rush", "Bonobo", "Migration", 300, "instrumental", true, ["electronic"], 0.5, ["groovy", "dreamy"], "none"],
  ["a-moment-apart", "A Moment Apart", "ODESZA", "A Moment Apart", 270, "instrumental", true, ["electronic"], 0.55, ["uplifting", "bright"], "none"],
  ["immunity", "Immunity", "Jon Hopkins", "Immunity", 330, "instrumental", true, ["electronic", "ambient"], 0.45, ["focus", "calm"], "none"],
  ["the-xx-intro", "Intro", "The xx", "xx", 128, "instrumental", true, ["electronic", "indie"], 0.4, ["calm", "focus"], "none"],
  ["harder-better-faster", "Harder, Better, Faster, Stronger", "Daft Punk", "Discovery", 224, "en", false, ["electronic"], 0.7, ["uplifting", "groovy"], "high"],
  ["something-about-us", "Something About Us", "Daft Punk", "Discovery", 193, "en", false, ["electronic"], 0.5, ["warm", "groovy"], "medium"],
  ["midnight-city", "Midnight City", "M83", "Hurry Up, We're Dreaming", 243, "en", false, ["electronic", "indie"], 0.65, ["uplifting", "bright"], "medium"],
  ["levels", "Levels", "Avicii", "Levels", 270, "instrumental", true, ["electronic"], 0.75, ["uplifting", "bright"], "none"],
  // ---------- 爵士 ----------
  ["waltz-for-debby", "Waltz for Debby", "Bill Evans Trio", "Waltz for Debby", 414, "instrumental", true, ["jazz"], 0.35, ["calm", "dreamy"], "none"],
  ["blue-in-green", "Blue in Green", "Miles Davis", "Kind of Blue", 337, "instrumental", true, ["jazz"], 0.25, ["melancholic", "calm"], "none"],
  ["dont-know-why", "Don't Know Why", "Norah Jones", "Come Away with Me", 186, "en", false, ["jazz"], 0.4, ["calm", "warm"], "medium"],
  ["almost-blue", "Almost Blue", "Chet Baker", void 0, 273, "en", false, ["jazz"], 0.3, ["melancholic", "gentle"], "low"],
  // ---------- City Pop / 日系 ----------
  ["plastic-love", "Plastic Love", "\u7AF9\u5185\u307E\u308A\u3084", "VARIETY", 283, "ja", false, ["city-pop"], 0.55, ["groovy", "melancholic"], "high"],
  ["stay-with-me", "\u771F\u591C\u4E2D\u306E\u30C9\u30A2 / Stay With Me", "\u677E\u539F\u307F\u304D", "POCKET PARK", 283, "ja", false, ["city-pop"], 0.55, ["groovy", "bright"], "high"],
  ["ride-on-time", "RIDE ON TIME", "\u5C71\u4E0B\u9054\u90CE", "RIDE ON TIME", 240, "ja", false, ["city-pop"], 0.65, ["uplifting", "bright"], "high"],
  ["night-cruising", "\u30CA\u30A4\u30C8\u30AF\u30EB\u30FC\u30B8\u30F3\u30B0", "\u30D5\u30A3\u30C3\u30B7\u30E5\u30DE\u30F3\u30BA", "LONG SEASON", 300, "ja", false, ["city-pop", "indie"], 0.45, ["dreamy", "groovy"], "medium"],
  ["yoru-ni-akeru", "\u591C\u306B\u99C6\u3051\u308B", "YOASOBI", "THE BOOK", 271, "ja", false, ["acg", "pop"], 0.6, ["bright", "uplifting"], "high"],
  ["sparkle", "\u30B9\u30D1\u30FC\u30AF\u30EB", "RADWIMPS", "\u541B\u306E\u540D\u306F\u3002", 375, "ja", false, ["acg", "rock"], 0.5, ["dreamy", "uplifting"], "high"],
  ["brave-shine", "Brave Shine", "Aimer", "DAWN", 260, "ja", false, ["acg"], 0.55, ["uplifting", "focus"], "high"],
  ["gurenge", "\u7D05\u84EE\u83EF", "LiSA", "LEO-NiNE", 304, "ja", false, ["acg", "rock"], 0.7, ["uplifting", "bright"], "high"],
  // ---------- 中文流行 / 民谣 / 摇滚 ----------
  ["qing-tian", "\u6674\u5929", "\u5468\u6770\u4F26", "\u53F6\u60E0\u7F8E", 269, "zh", false, ["pop"], 0.5, ["warm", "melancholic"], "high"],
  ["ye-qu", "\u591C\u66F2", "\u5468\u6770\u4F26", "\u5341\u4E00\u6708\u7684\u8427\u90A6", 226, "zh", false, ["pop", "hiphop"], 0.5, ["melancholic", "focus"], "high"],
  ["pu-gong-ying", "\u84B2\u516C\u82F1\u7684\u7EA6\u5B9A", "\u5468\u6770\u4F26", "\u6211\u5F88\u5FD9", 240, "zh", false, ["pop"], 0.4, ["calm", "gentle"], "high"],
  ["lv-xing-de-yi-yi", "\u65C5\u884C\u7684\u610F\u4E49", "\u9648\u7EEE\u8D1E", "Groupies \u5409\u4ED6\u624B", 216, "zh", false, ["folk"], 0.35, ["gentle", "warm"], "medium"],
  ["yun-yan-cheng-yu", "\u4E91\u70DF\u6210\u96E8", "\u623F\u4E1C\u7684\u732B", "\u4E91\u70DF\u6210\u96E8", 233, "zh", false, ["folk"], 0.3, ["calm", "melancholic"], "medium"],
  ["mei-hao-shi-wu", "\u7F8E\u597D\u4E8B\u7269", "\u623F\u4E1C\u7684\u732B", "\u623F\u4E1C\u7684\u732B", 250, "zh", false, ["folk"], 0.35, ["warm", "gentle"], "medium"],
  ["sha-si-shi-jia-zhuang", "\u6740\u6B7B\u90A3\u4E2A\u77F3\u5BB6\u5E84\u4EBA", "\u4E07\u80FD\u9752\u5E74\u65C5\u5E97", "\u4E07\u80FD\u9752\u5E74\u65C5\u5E97", 325, "zh", false, ["rock"], 0.6, ["melancholic", "uplifting"], "high"],
  ["shan-hai", "\u5C71\u6D77", "\u8349\u4E1C\u6CA1\u6709\u6D3E\u5BF9", "\u4E11\u5974\u513F", 300, "zh", false, ["rock"], 0.65, ["melancholic", "uplifting"], "high"],
  ["hao-jiu-bu-jian", "\u597D\u4E45\u4E0D\u89C1", "\u9648\u5955\u8FC5", "\u8BA4\u4E86\u5427", 270, "zh", false, ["pop"], 0.4, ["melancholic", "calm"], "high"],
  ["wen-rou", "\u6E29\u67D4", "\u4E94\u6708\u5929", "\u7231\u60C5\u4E07\u5C81", 277, "zh", false, ["rock", "pop"], 0.5, ["warm", "gentle"], "high"],
  ["jue-jiang", "\u5014\u5F3A", "\u4E94\u6708\u5929", "\u795E\u7684\u5B69\u5B50\u90FD\u5728\u8DF3\u821E", 300, "zh", false, ["rock"], 0.6, ["uplifting", "bright"], "high"],
  ["xiao-qing-ge", "\u5C0F\u60C5\u6B4C", "\u82CF\u6253\u7EFF", "\u5C0F\u5B87\u5B99", 265, "zh", false, ["pop"], 0.45, ["warm", "gentle"], "high"],
  ["ping-fan-zhi-lu", "\u5E73\u51E1\u4E4B\u8DEF", "\u6734\u6811", "\u730E\u6237\u661F\u5EA7", 320, "zh", false, ["folk", "rock"], 0.5, ["melancholic", "uplifting"], "high"],
  ["ye-kong-zhong-zui-liang-de-xing", "\u591C\u7A7A\u4E2D\u6700\u4EAE\u7684\u661F", "\u9003\u8DD1\u8BA1\u5212", "\u4E16\u754C", 270, "zh", false, ["rock"], 0.55, ["uplifting", "warm"], "high"],
  ["cheng-du", "\u6210\u90FD", "\u8D75\u96F7", "\u65E0\u6CD5\u957F\u5927", 325, "zh", false, ["folk"], 0.4, ["warm", "gentle"], "medium"],
  ["ban-ma", "\u6591\u9A6C\uFF0C\u6591\u9A6C", "\u5B8B\u51AC\u91CE", "\u5B89\u548C\u6865\u5317", 300, "zh", false, ["folk"], 0.35, ["melancholic", "calm"], "medium"],
  ["tong-zhuo-de-ni", "\u540C\u684C\u7684\u4F60", "\u8001\u72FC", "\u604B\u604B\u98CE\u5C18", 270, "zh", false, ["folk"], 0.35, ["warm", "gentle"], "medium"],
  ["nian-shao-you-wei", "\u5E74\u5C11\u6709\u4E3A", "\u674E\u8363\u6D69", "\u8033\u6735", 268, "zh", false, ["pop"], 0.45, ["melancholic", "warm"], "high"],
  ["bu-jian-chang-an", "\u4E0D\u89C1\u957F\u5B89", "\u6CB3\u56FE", "\u98CE\u8D77\u5929\u9611", 276, "zh", false, ["folk"], 0.35, ["dreamy", "calm"], "medium"],
  // ---------- 英文流行 / 独立 ----------
  ["sparks", "Sparks", "Coldplay", "Parachutes", 230, "en", false, ["pop", "indie"], 0.35, ["calm", "dreamy"], "medium"],
  ["viva-la-vida", "Viva La Vida", "Coldplay", "Viva La Vida", 245, "en", false, ["pop", "rock"], 0.65, ["uplifting", "bright"], "high"],
  ["photograph", "Photograph", "Ed Sheeran", "x", 258, "en", false, ["pop"], 0.45, ["warm", "gentle"], "medium"],
  ["ocean-eyes", "Ocean Eyes", "Billie Eilish", "dont smile at me", 200, "en", false, ["pop"], 0.3, ["dreamy", "calm"], "medium"],
  ["holocene", "Holocene", "Bon Iver", "Bon Iver", 336, "en", false, ["folk", "indie"], 0.35, ["calm", "melancholic"], "medium"],
  ["flightless-bird", "Flightless Bird, American Mouth", "Iron & Wine", "The Shepherd's Dog", 250, "en", false, ["folk"], 0.35, ["dreamy", "gentle"], "medium"],
  ["id-rather-dance", "I'd Rather Dance with You", "Kings of Convenience", "Riot on an Empty Street", 200, "en", false, ["indie", "folk"], 0.45, ["groovy", "bright"], "medium"],
  ["homesick-koc", "Homesick", "Kings of Convenience", "Riot on an Empty Street", 210, "en", false, ["indie", "folk"], 0.35, ["calm", "gentle"], "medium"],
  // ---------- 韩语 ----------
  ["bam-pyeonji", "\uBC24\uD3B8\uC9C0", "IU", "Palette", 280, "ko", false, ["pop"], 0.35, ["calm", "warm"], "medium"],
  ["travel", "\uC5EC\uD589", "\uBCFC\uBE68\uAC04\uC0AC\uCD98\uAE30", "RED ICKLE", 210, "ko", false, ["pop"], 0.5, ["bright", "gentle"], "medium"]
];
var cached;
function getSampleLibrary() {
  if (cached) return cached;
  cached = ROWS.map(([id, title, artist, album, durationSec, language, isInstrumental, genres, energy, moodTags, vocalDensity]) => ({
    id,
    title,
    artist,
    album,
    durationSec,
    language,
    isInstrumental,
    genres,
    energy,
    moodTags,
    vocalDensity,
    source: { kind: "sample" },
    netease: { searchKeyword: `${title} ${artist}` }
  }));
  return cached;
}

// src/server/app.ts
var import_node_crypto = require("node:crypto");
async function seedSampleIfFirstRun(store) {
  if (await store.loadFlag("seeded")) return false;
  const tracks = await store.loadTracks();
  if (tracks.length > 0) {
    await store.saveFlag("seeded");
    return false;
  }
  await store.saveTracks(getSampleLibrary());
  await store.saveFlag("seeded");
  return true;
}
function createApp({ store, now = () => /* @__PURE__ */ new Date() }) {
  const app2 = new Hono2();
  app2.onError((err, c) => {
    console.error("[api]", err);
    return c.json({ error: err.message ?? "\u5185\u90E8\u9519\u8BEF" }, 500);
  });
  app2.get("/api/health", (c) => c.json({ ok: true, time: now().toISOString() }));
  app2.get("/api/history", async (c) => {
    const [sessions, feedback, tracks] = await Promise.all([
      store.loadSessions(),
      store.loadFeedback(),
      store.loadTracks()
    ]);
    const trackById = new Map(tracks.map((t) => [t.id, t]));
    const feedbackBySessionTrack = /* @__PURE__ */ new Map();
    for (const event of feedback) {
      if (event.sessionId === void 0) continue;
      const perTrack = feedbackBySessionTrack.get(event.sessionId) ?? /* @__PURE__ */ new Map();
      perTrack.set(event.trackId, event.type);
      feedbackBySessionTrack.set(event.sessionId, perTrack);
    }
    const recent = [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10).map((s) => {
      const perTrack = feedbackBySessionTrack.get(s.id);
      return {
        id: s.id,
        createdAt: s.createdAt,
        context: s.context,
        tracks: s.trackIds.map((id) => trackById.get(id)).filter((t) => t !== void 0).map((t) => ({ track: t, feedback: perTrack?.get(t.id) }))
      };
    });
    const stats = {
      likes: feedback.filter((f) => f.type === "like").length,
      skips: feedback.filter((f) => f.type === "skip").length,
      rejected: feedback.filter((f) => f.type === "not_suitable").length
    };
    return c.json({ sessions: recent, stats });
  });
  app2.get("/api/library", async (c) => {
    const tracks = await store.loadTracks();
    return c.json({ count: tracks.length, tracks });
  });
  app2.post("/api/library/import", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON" }, 400);
    }
    const rows = body?.tracks ?? body;
    const existing = new Set((await store.loadTracks()).map((t) => t.id));
    const result = validateImportRows(rows, { existingIds: existing });
    if (result.accepted.length > 0) {
      await store.saveTracks([...await store.loadTracks(), ...result.accepted]);
    }
    return c.json({ imported: result.accepted.length, rejected: result.rejected });
  });
  app2.post("/api/library/import-csv", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON" }, 400);
    }
    const csv = body?.csv;
    if (typeof csv !== "string" || csv.trim() === "") {
      return c.json({ error: "\u7F3A\u5C11 csv \u6587\u672C" }, 400);
    }
    const existing = new Set((await store.loadTracks()).map((t) => t.id));
    const result = importCsv(csv, { existingIds: existing });
    if (result.accepted.length > 0) {
      await store.saveTracks([...await store.loadTracks(), ...result.accepted]);
    }
    return c.json({ imported: result.accepted.length, rejected: result.rejected });
  });
  app2.get("/api/now-playing", async (c) => c.json(await detectNowPlaying()));
  app2.post("/api/playlist", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON" }, 400);
    }
    const { input, sessionId } = body ?? {};
    if (typeof input !== "string" || input.trim().length === 0) {
      return c.json({ error: "\u8BF7\u63CF\u8FF0\u4F60\u73B0\u5728\u7684\u72B6\u6001" }, 400);
    }
    const context = parseContext(input).context;
    const tracks = await store.loadTracks();
    if (tracks.length === 0) {
      return c.json({ error: "\u97F3\u4E50\u5E93\u4E3A\u7A7A\uFF0C\u8BF7\u5148\u5728\u300C\u97F3\u4E50\u5E93\u300D\u5BFC\u5165\u6570\u636E" }, 400);
    }
    const sid = typeof sessionId === "string" && sessionId ? sessionId : (0, import_node_crypto.randomUUID)();
    const feedback = await store.loadFeedback();
    const sessions = await store.loadSessions();
    const recentTrackIds = sessions.filter((s) => s.id !== sid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2).flatMap((s) => s.trackIds);
    const rejected = new Set(
      feedback.filter((f) => f.sessionId === sid && f.type === "not_suitable").map((f) => f.trackId)
    );
    const ranked = recommend({
      tracks,
      context,
      feedbackEvents: feedback,
      recentTrackIds,
      excludeTrackIds: [...rejected],
      limit: 60,
      now: now()
    });
    const playlist = buildPlaylist(ranked, context.durationMinutes);
    const session = {
      id: sid,
      createdAt: now().toISOString(),
      context,
      trackIds: playlist.tracks.map((r) => r.track.id)
    };
    await store.upsertSession(session);
    return c.json({ sessionId: sid, context, playlist });
  });
  app2.post("/api/tracks/:id/learn", async (c) => {
    const trackId = c.req.param("id");
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON" }, 400);
    }
    const text = body?.text;
    if (typeof text !== "string" || text.trim() === "") {
      return c.json({ error: "\u8BF7\u63CF\u8FF0\u8FD9\u9996\u6B4C\u7ED9\u4F60\u7684\u611F\u53D7" }, 400);
    }
    const tracks = await store.loadTracks();
    const track = tracks.find((t) => t.id === trackId);
    if (track === void 0) return c.json({ error: "\u66F2\u76EE\u4E0D\u5B58\u5728" }, 404);
    const delta = parseSongFeedback(text);
    if (!delta.understood) {
      return c.json(
        { error: "\u6CA1\u7406\u89E3\u4F60\u7684\u63CF\u8FF0\u3002\u53EF\u4EE5\u8BD5\u8BD5\uFF1A\u300E\u6709\u529B\u6C14\u3001\u63D0\u9AD8\u7CBE\u529B\u300F\u300E\u5F88\u5B89\u9759\u3001\u80FD\u9759\u5FC3\u300F\u300E\u6CA1\u6709\u6B4C\u8BCD\u300F\u8FD9\u7C7B\u8BF4\u6CD5" },
        422
      );
    }
    const { track: updated, changes } = applyFeatureDelta(track, delta);
    await store.saveTracks(tracks.map((t) => t.id === trackId ? updated : t));
    await store.appendLearnEvent({
      id: (0, import_node_crypto.randomUUID)(),
      trackId,
      text: text.trim(),
      delta: {
        energyHint: delta.energyHint,
        moodTags: delta.moodTags,
        vocalDensity: delta.vocalDensity,
        matched: delta.matched
      },
      parsedBy: "rules",
      changes,
      createdAt: now().toISOString()
    });
    return c.json({ track: updated, changes, matched: delta.matched });
  });
  app2.post("/api/recommend", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON" }, 400);
    }
    const { input, sessionId, excludeTrackIds } = body ?? {};
    if (typeof input !== "string" || input.trim().length === 0) {
      return c.json({ error: "\u8BF7\u63CF\u8FF0\u4F60\u73B0\u5728\u7684\u72B6\u6001" }, 400);
    }
    if (input.length > 2e3) {
      return c.json({ error: "\u63CF\u8FF0\u592A\u957F\u4E86\uFF08\u4E0A\u9650 2000 \u5B57\uFF09" }, 400);
    }
    const context = parseContext(input).context;
    const tracks = await store.loadTracks();
    if (tracks.length === 0) {
      return c.json({ error: "\u97F3\u4E50\u5E93\u4E3A\u7A7A\uFF0C\u8BF7\u5148\u5728\u300C\u97F3\u4E50\u5E93\u300D\u5BFC\u5165\u6570\u636E" }, 400);
    }
    const sid = typeof sessionId === "string" && sessionId ? sessionId : (0, import_node_crypto.randomUUID)();
    const feedback = await store.loadFeedback();
    const sessions = await store.loadSessions();
    const sessionRejected = new Set(
      feedback.filter((f) => f.sessionId === sid && f.type === "not_suitable").map((f) => f.trackId)
    );
    if (Array.isArray(excludeTrackIds)) {
      for (const id of excludeTrackIds) {
        if (typeof id === "string") sessionRejected.add(id);
      }
    }
    const recentTrackIds = sessions.filter((s) => s.id !== sid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2).flatMap((s) => s.trackIds);
    const recommendations = recommend({
      tracks,
      context,
      feedbackEvents: feedback,
      recentTrackIds,
      excludeTrackIds: [...sessionRejected],
      limit: 10,
      now: now()
    });
    const session = {
      id: sid,
      createdAt: now().toISOString(),
      context,
      trackIds: recommendations.map((r) => r.track.id)
    };
    await store.upsertSession(session);
    return c.json({ sessionId: sid, context, recommendations });
  });
  app2.post("/api/feedback", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON" }, 400);
    }
    const { trackId, sessionId, type } = body ?? {};
    if (typeof trackId !== "string" || !trackId) return c.json({ error: "\u7F3A\u5C11 trackId" }, 400);
    const validTypes = ["like", "skip", "not_suitable"];
    if (typeof type !== "string" || !validTypes.includes(type)) {
      return c.json({ error: `type \u5FC5\u987B\u662F ${validTypes.join("/")}` }, 400);
    }
    const tracks = await store.loadTracks();
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return c.json({ error: "\u66F2\u76EE\u4E0D\u5B58\u5728" }, 404);
    const sessions = await store.loadSessions();
    const sid = typeof sessionId === "string" && sessionId ? sessionId : void 0;
    const session = sid ? sessions.find((s) => s.id === sid) : void 0;
    const event = {
      id: (0, import_node_crypto.randomUUID)(),
      trackId,
      type,
      sessionId: sid,
      contextSnapshot: session ? {
        task: session.context.task,
        energy: session.context.energy,
        stress: session.context.stress,
        focusDifficulty: session.context.focusDifficulty
      } : void 0,
      createdAt: now().toISOString()
    };
    await store.appendFeedback(event);
    return c.json({ ok: true, eventId: event.id });
  });
  return app2;
}

// src/storage/jsonStore.ts
var import_node_fs = require("node:fs");
var import_node_path = __toESM(require("node:path"), 1);
var JsonFileStore = class {
  dir;
  constructor(dataDir) {
    this.dir = dataDir;
  }
  async init() {
    await import_node_fs.promises.mkdir(this.dir, { recursive: true });
  }
  file(name) {
    return import_node_path.default.join(this.dir, name);
  }
  async readJson(name, fallback) {
    try {
      const raw2 = await import_node_fs.promises.readFile(this.file(name), "utf8");
      return JSON.parse(raw2);
    } catch (err) {
      const code = err.code;
      if (code === "ENOENT") return fallback;
      throw new Error(`\u6570\u636E\u6587\u4EF6 ${name} \u8BFB\u53D6\u5931\u8D25: ${err.message}`);
    }
  }
  async writeJson(name, value) {
    const target = this.file(name);
    const tmp = `${target}.tmp`;
    await import_node_fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await import_node_fs.promises.rename(tmp, target);
  }
  async loadTracks() {
    const data = await this.readJson("library.json", { tracks: [] });
    return data.tracks;
  }
  async saveTracks(tracks) {
    await this.writeJson("library.json", { tracks, savedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
  async loadFeedback() {
    const data = await this.readJson("feedback.json", { events: [] });
    return data.events;
  }
  async appendFeedback(event) {
    const data = await this.readJson("feedback.json", { events: [] });
    data.events.push(event);
    await this.writeJson("feedback.json", data);
  }
  async loadSessions() {
    const data = await this.readJson("sessions.json", { sessions: [] });
    return data.sessions;
  }
  async appendSession(session) {
    const data = await this.readJson("sessions.json", { sessions: [] });
    data.sessions.push(session);
    const trimmed = data.sessions.slice(-200);
    await this.writeJson("sessions.json", { sessions: trimmed });
  }
  async upsertSession(session) {
    const data = await this.readJson("sessions.json", { sessions: [] });
    const index = data.sessions.findIndex((s) => s.id === session.id);
    if (index >= 0) data.sessions[index] = session;
    else data.sessions.push(session);
    const trimmed = data.sessions.slice(-200);
    await this.writeJson("sessions.json", { sessions: trimmed });
  }
  async loadFlag(name) {
    return this.readJson(`flag-${name}.json`, { value: false }).then((d) => d.value === true);
  }
  async saveFlag(name) {
    await this.writeJson(`flag-${name}.json`, { value: true });
  }
  async loadLearnEvents() {
    const data = await this.readJson("learnEvents.json", { events: [] });
    return data.events;
  }
  async appendLearnEvent(event) {
    const data = await this.readJson("learnEvents.json", { events: [] });
    data.events.push(event);
    await this.writeJson("learnEvents.json", data);
  }
};

// electron/main.ts
var MAIN_SIZE = { width: 1e3, height: 800 };
var MINI_SIZE = { width: 380, height: 640 };
var mainWindow = null;
function pickPort(preferred) {
  const { createServer } = require("node:net");
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => {
      if (preferred < 8795) resolve(pickPort(preferred + 1));
      else reject(new Error("no free port"));
    });
    probe.once("listening", () => {
      probe.close(() => resolve(preferred));
    });
    probe.listen(preferred, "127.0.0.1");
  });
}
async function startApi() {
  const dataDir = import_electron.app.isPackaged ? import_node_path2.default.join(import_electron.app.getPath("userData"), "data") : import_node_path2.default.resolve("data");
  const store = new JsonFileStore(dataDir);
  await store.init();
  if (await seedSampleIfFirstRun(store)) {
    console.log("[studymood] \u9996\u6B21\u8FD0\u884C\uFF1A\u5DF2\u5BFC\u5165\u793A\u4F8B\u97F3\u4E50\u5E93");
  }
  const appHono = createApp({ store });
  const webDist = import_electron.app.isPackaged ? import_node_path2.default.join(process.resourcesPath ?? "", "web") : import_node_path2.default.resolve("dist/web");
  if ((0, import_node_fs2.existsSync)(webDist)) {
    const root = import_node_path2.default.relative(process.cwd(), webDist);
    appHono.use("*", serveStatic({ root }));
    appHono.get("*", serveStatic({ root, path: "/index.html" }));
  }
  const port = await pickPort(8787);
  await new Promise((resolve, reject) => {
    const server = serve({ fetch: appHono.fetch, port, hostname: "127.0.0.1" }, () => {
      console.log(`[studymood] API: http://127.0.0.1:${port}  \u6570\u636E: ${dataDir}`);
      resolve();
    });
    server.on("error", reject);
  });
  return port;
}
function applyMode(win, mini) {
  if (mini) {
    win.setMinimumSize(340, 520);
    win.setBounds(MINI_SIZE);
    win.setAlwaysOnTop(true, "screen-saver");
  } else {
    win.setAlwaysOnTop(false);
    win.setMinimumSize(720, 560);
    win.setBounds(MAIN_SIZE);
  }
}
function createWindow(port) {
  mainWindow = new import_electron.BrowserWindow({
    ...MAIN_SIZE,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#fdf3f4",
    autoHideMenuBar: true,
    title: "StudyMood DJ",
    webPreferences: {
      preload: import_node_path2.default.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  void mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      mainWindow?.webContents.toggleDevTools();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
var gotLock = import_electron.app.requestSingleInstanceLock();
if (!gotLock) {
  import_electron.app.quit();
} else {
  import_electron.app.on("second-instance", () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  import_electron.Menu.setApplicationMenu(null);
  void import_electron.app.whenReady().then(async () => {
    import_electron.ipcMain.handle("window:set-mini-mode", (_event, mini) => {
      if (mainWindow !== null) applyMode(mainWindow, mini === true);
      return true;
    });
    try {
      const port = await startApi();
      createWindow(port);
    } catch (err) {
      console.error("[studymood] \u542F\u52A8\u5931\u8D25:", err);
      import_electron.app.quit();
    }
  });
  import_electron.app.on("window-all-closed", () => {
    import_electron.app.quit();
  });
}
