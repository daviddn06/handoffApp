// Hosting migration bridge. Preserves the published landing UI and copy.
(() => {
  const app = "https://app.handofflease.com";
  const routes = new Map([
    ["Sign in", "/sign-in"],
    ["Sign up", "/sign-up"],
    ["List your sublease", "/listings/new"],
    ["List your space", "/listings/new"],
    ["List", "/listings/new"],
    ["Search Subleases", "/browse"],
    ["Start Searching", "/browse"],
    ["Browse listings", "/browse"],
    ["Browse first", "/browse"],
  ]);
  document.addEventListener(
    "click",
    (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const element = event.target.closest("button, a");
      if (!element) return;
      const label = (element.innerText || element.textContent)
        .trim()
        .replace(/\s+/g, " ");
      let destination = routes.get(label);
      if (element.tagName === "A") {
        const url = new URL(element.href, location.origin);
        if (
          url.origin === location.origin &&
          /^\/(listings|browse|dashboard|profile|sign-in|sign-up)(\/|$)/.test(
            url.pathname,
          )
        ) {
          destination =
            url.pathname === "/listings"
              ? "/browse"
              : url.pathname === "/dashboard"
                ? "/my-listings"
                : url.pathname;
        }
      }
      if (destination) {
        event.preventDefault();
        event.stopImmediatePropagation();
        location.assign(app + destination);
      }
    },
    true,
  );
})();
