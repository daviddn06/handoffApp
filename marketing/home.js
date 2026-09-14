const journeyButtons = document.querySelectorAll("[data-journey]");
journeyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const selected = button.dataset.journey;
    journeyButtons.forEach((item) =>
      item.setAttribute("aria-pressed", String(item === button)),
    );
    document.querySelectorAll(".journey-panel").forEach((panel) => {
      panel.hidden = panel.id !== `${selected}-steps`;
    });
  });
});
document.querySelectorAll('a[href="#contact-privacy"]').forEach((link) => {
  link.addEventListener("click", () => {
    document.getElementById("contact-privacy").open = true;
  });
});
document.getElementById("year").textContent = String(new Date().getFullYear());
