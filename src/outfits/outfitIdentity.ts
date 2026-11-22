/** An outfit's identity whatever order its pieces come in (Today's list and a swap's ids differ). */
export function outfitIdentity(garmentIds: readonly string[]): string {
  return [...garmentIds].sort().join(',');
}
