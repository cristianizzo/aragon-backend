/**
 * Build the deterministic `<subdomain>.dao.eth` ENS name for an Aragon DAO.
 *
 * Aragon's SubdomainRegistrar mints `.dao.eth` subdomains on mainnet ENS
 * regardless of the chain the DAO lives on, so the only gate is that the
 * registration event carried a non-empty subdomain. Pure string work —
 * mainnet ownership is not cross-checked here; revisit if drift shows up
 * in production.
 */
export function buildDaoEnsName(subdomain: string): string | null {
  if (!subdomain) return null;
  const cleaned = subdomain.replace(/\.dao\.eth$/i, "");
  return cleaned ? `${cleaned}.dao.eth` : null;
}
