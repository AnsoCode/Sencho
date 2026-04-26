/**
 * Heuristic binary detection based on byte-range sampling.
 * Printable bytes: 0x09-0x0D (tab, LF, VT, FF, CR) and 0x20-0x7E.
 * Any NUL byte is an immediate binary signal (text editors never produce them).
 * If more than 30% of sampled bytes are non-printable the buffer is treated as binary.
 */
export function isBinaryBuffer(buf: Buffer, sampleBytes = 8192): boolean {
  if (buf.length === 0) return false;

  const sample = buf.subarray(0, sampleBytes);
  let nonPrintable = 0;

  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0x00) return true;
    const isPrintable = (b >= 0x09 && b <= 0x0d) || (b >= 0x20 && b <= 0x7e);
    if (!isPrintable) nonPrintable++;
  }

  return nonPrintable / sample.length > 0.3;
}
