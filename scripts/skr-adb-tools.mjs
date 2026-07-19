const SKR_MATCH = /(?:^|[^a-z0-9_-])@?([a-z0-9][a-z0-9_-]{0,63}\.skr)(?=$|[^a-z0-9_.-])/giu;
const PRIVATE_OR_LOOPBACK = /^(?:127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}):(\d{1,5})$/;

export function extractSkrNames(value) {
  const decoded = String(value ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .normalize("NFKC");
  const names = new Set();
  for (const match of decoded.matchAll(SKR_MATCH)) names.add(match[1].toLocaleLowerCase("en-US"));
  return [...names];
}

export function extractSkrOcrCandidates(value) {
  const best = new Map();
  for (const line of String(value ?? "").split(/\r?\n/)) {
    const match = line.match(/^(\d+)\t([01](?:\.\d+)?)\t([\s\S]+)$/);
    if (!match) continue;
    const observation = Number(match[1]);
    const confidence = Number(match[2]);
    for (const name of extractSkrNames(match[3])) {
      const current = best.get(name);
      if (!current || confidence > current.confidence) best.set(name, { confidence, observation });
    }
  }
  return [...best.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name));
}

export function validateAdbAddress(value) {
  const address = String(value ?? "").trim();
  const match = address.match(PRIVATE_OR_LOOPBACK);
  const port = Number(match?.[1] ?? 0);
  const host = address.split(":")[0];
  const validOctets = host.split(".").every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if (!match || !validOctets || port < 1 || port > 65_535) throw Object.assign(new Error("Use a private phone address in IP:PORT format"), { status: 400 });
  return address;
}

export function validatePairingCode(value) {
  const code = String(value ?? "").trim();
  if (!/^\d{6}$/.test(code)) throw Object.assign(new Error("The Wireless debugging pairing code must contain six digits"), { status: 400 });
  return code;
}
