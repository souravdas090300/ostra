import dns from "dns";
import net from "net";
import { Agent, fetch, type Response } from "undici";
import { isSafeFeedUrl } from "./validation";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** Errors whose message is safe to show to the host. */
export class FeedError extends Error {}

export function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a >= 224                              // multicast + reserved
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    return (
      x === "::1" || x === "::" ||
      x.startsWith("::ffff:") ||            // IPv4-mapped: reject outright
      /^fe[89ab]/.test(x) ||                // link-local
      x.startsWith("fc") || x.startsWith("fd") // unique local
    );
  }
  return true; // not an IP at all: treat as unsafe
}

const agent = new Agent({
  connect: {
    timeout: TIMEOUT_MS,
    // Validate the resolved addresses at connection time.
    lookup(hostname, options, callback) {
      dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
        if (err) {
          return callback(err, "", 0);
        }
        if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
          return callback(new Error("Blocked address"), "", 0);
        }
        if ((options as { all?: boolean }).all) {
          return callback(null, addrs as unknown as string, 0);
        }
        return callback(null, addrs[0].address, addrs[0].family);
      });
    },
  },
});

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new FeedError("The calendar file is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchFeedText(url: string): Promise<string> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!isSafeFeedUrl(current)) throw new FeedError("This calendar link is not allowed.");
    let res: Response;
    try {
      res = await fetch(current, {
        dispatcher: agent,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "user-agent": "Ostra/1.0 (calendar sync)",
          accept: "text/calendar, text/plain, */*",
        },
      });
    } catch {
      throw new FeedError("Could not reach the calendar provider."); // never include the URL
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new FeedError("The calendar provider sent a bad redirect.");
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new FeedError(`The calendar provider returned an error (HTTP ${res.status}).`);
    }
    return readLimited(res);
  }
  throw new FeedError("Too many redirects.");
}
