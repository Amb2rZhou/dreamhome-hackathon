const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * Restores the approved built-in demo homes without touching user-created homes.
 * Existing copies of built-in homes are replaced because the checked-in snapshot
 * is the canonical demo scene; unrelated projects keep their original order.
 */
export function restoreApprovedHomes(homes, approvedHomes, legacyVideoIds = []) {
  const existingHomes = Array.isArray(homes) ? homes : [];
  const defaults = Array.isArray(approvedHomes) ? approvedHomes : [];
  const approvedIds = new Set(defaults.map((home) => home?.id).filter(Boolean));
  const legacyIds = new Set(legacyVideoIds);
  const userHomes = existingHomes.filter((home) => (
    home?.id
    && !approvedIds.has(home.id)
    && !legacyIds.has(home.source?.videoId)
  ));

  return [...clone(defaults), ...userHomes];
}

