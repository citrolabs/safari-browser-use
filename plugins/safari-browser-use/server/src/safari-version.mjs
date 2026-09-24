const LATEST_KNOWN_SAFARI_MAJOR = 27;

export function parseSafariMajor(version) {
  const match = /^(\d+)(?:\.|$)/.exec(version);

  if (!match) {
    throw new Error(`Invalid Safari version: ${version}`);
  }

  return Number(match[1]);
}

export function evaluateSafariVersion(version) {
  const major = parseSafariMajor(version);

  return {
    supported: true,
    major,
    known: major <= LATEST_KNOWN_SAFARI_MAJOR,
    reason: null
  };
}
