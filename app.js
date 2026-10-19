fetch("selections.json")
  .then((r) => r.json())
  .then(render)
  .catch(() => {
    document.getElementById("stamp").textContent = "Could not load the data.";
  });

function render(data) {
  document.getElementById("stamp").textContent =
    "Model run " + (data.as_of || "unknown") + " UTC \u00b7 page built " + data.generated_at;

  const bar = document.getElementById("bar");
  (data.entry_bar || []).forEach((r) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.innerHTML =
      '<div class="legs"></div><div class="need"></div><div class="alt"></div>';
    cell.querySelector(".legs").textContent = r.legs + " picks at " + r.multiplier + "x";
    cell.querySelector(".need").textContent = (r.unrelated * 100).toFixed(1) + "%";
    cell.querySelector(".alt").textContent = "stacked " + (r.stacked * 100).toFixed(1) + "%";
    bar.appendChild(cell);
  });

  const rows = data.selections || [];
  document.getElementById("empty").hidden = rows.length !== 0;

  const games = new Map();
  rows.forEach((r) => {
    const key = r.gameday + "|" + r.game;
    if (!games.has(key)) games.set(key, []);
    games.get(key).push(r);
  });

  const slate = document.getElementById("slate");
  const order = ["pass_attempts", "carries", "targets", "receptions"];
  [...games.keys()].sort().forEach((key) => {
    const [gameday, game] = key.split("|");
    const box = document.createElement("div");
    box.className = "fixture";

    const head = document.createElement("h3");
    const teams = document.createElement("span");
    teams.textContent = game;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = new Date(gameday + "T12:00:00Z").toLocaleDateString(undefined,
      { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    head.appendChild(teams);
    head.appendChild(when);
    box.appendChild(head);

    games.get(key)
      .sort((a, b) => order.indexOf(a.market) - order.indexOf(b.market))
      .forEach((r) => {
        const leg = document.createElement("div");
        leg.className = "leg";
        const who = document.createElement("div");
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = r.player;
        const what = document.createElement("div");
        what.className = "what";
        what.textContent = r.market.replace(/_/g, " ");
        who.appendChild(name);
        who.appendChild(what);

        const nums = document.createElement("div");
        nums.className = "nums";
        const side = document.createElement("div");
        side.className = "side";
        side.textContent = r.our_side + " " + r.underdog_line;
        const model = document.createElement("div");
        model.className = "model";
        model.textContent = "model " + r.model;
        nums.appendChild(side);
        nums.appendChild(model);

        leg.appendChild(who);
        leg.appendChild(nums);
        box.appendChild(leg);
      });
    slate.appendChild(box);
  });
}
