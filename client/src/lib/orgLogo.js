// A company's own logo when it has one set; otherwise the brand logo shipped with the app for the group's
// known companies (matched by slug), so every company shows its logo instead of an initial. Anything else
// falls back to the initial tile.
const BRAND_LOGOS = {
  delphic: '/Delphic_D-logo_transparent.png',
  gulati: '/gulati-logo.svg',
  zephyr: '/zephyr-logo.png',
  acconcy: '/acconcy-logo.png',
};

export function orgLogo(org) {
  return org?.logo_url || BRAND_LOGOS[org?.slug] || null;
}
