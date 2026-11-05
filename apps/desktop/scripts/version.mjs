// SemVer precedence, including prerelease identifiers, for feed rollback protection.
export function compare(a, b) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(value);
    if (!match) throw new Error('Invalid updater version');
    return { core: match.slice(1, 4).map(Number), pre: match[4]?.split('.') };
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return Math.sign(left.core[i] - right.core[i]);
  if (!left.pre || !right.pre) return left.pre ? -1 : right.pre ? 1 : 0;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return Math.sign(Number(x) - Number(y));
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
