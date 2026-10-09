(() => {
  "use strict";
  const stages = [...document.querySelectorAll("[data-stage]")];
  const links = [...document.querySelectorAll("[data-stage-link]")];
  const shell = document.getElementById("slide-shell");
  const key = "byteback.playbook.slides.v2";
  const statuses = ["Ready", "In progress", "Done"];
  const tasks = [
    { id: "setup", title: "Run ByteBack locally", note: "FIRST TASK / 01" },
    {
      id: "demo",
      title: "Complete the donation demo",
      note: "FIRST TASK / 02",
    },
    {
      id: "pr",
      title: "Open your first pull request",
      note: "FIRST TASK / 03",
    },
  ];
  let state = { complete: [], tasks: {}, customTasks: [] };
  let current = 0;
  let storageAvailable = true;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && typeof saved === "object") {
      if (Array.isArray(saved.complete))
        state.complete = saved.complete.filter((id) =>
          stages.some((stage) => stage.id === id),
        );
      if (saved.tasks && typeof saved.tasks === "object")
        state.tasks = saved.tasks;
      if (Array.isArray(saved.customTasks)) {
        state.customTasks = saved.customTasks
          .filter(
            (task) =>
              task &&
              typeof task.id === "string" &&
              /^custom-[a-z0-9-]+$/i.test(task.id) &&
              typeof task.title === "string" &&
              task.title.trim(),
          )
          .slice(0, 50)
          .map((task) => ({
            id: task.id,
            title: task.title.slice(0, 100),
            note: "YOUR TASK",
          }));
        tasks.push(...state.customTasks);
      }
    }
  } catch {
    storageAvailable = false;
  }
  function save() {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      storageAvailable = false;
    }
    if (!storageAvailable)
      document.getElementById("slide-announcement").textContent =
        "Storage unavailable. Progress is kept for this visit only.";
    if (!storageAvailable)
      document.querySelector(".os-status > span").textContent =
        "● Progress kept for this visit only";
  }
  function updateProgress() {
    const count = new Set(state.complete).size;
    document.getElementById("overall-progress").textContent =
      `${count} of 9 complete`;
    document.getElementById("progress-fill").style.width =
      `${(count / 9) * 100}%`;
    links.forEach((link, i) => {
      const done = state.complete.includes(stages[i].id);
      link.classList.toggle("is-complete", done);
      link.querySelector("span").textContent = done
        ? "✓"
        : String(i + 1).padStart(2, "0");
      link.setAttribute(
        "aria-label",
        `Stage ${i + 1}: ${stages[i].querySelector("h2").textContent}${done ? ", complete" : ""}`,
      );
    });
    const done = state.complete.includes(stages[current].id);
    document
      .getElementById("complete-stage")
      .setAttribute("aria-pressed", String(done));
    document.getElementById("complete-label").textContent = done
      ? "Nice. Mission checked off!"
      : "Got it. Check this off.";
  }
  function showStage(index, { updateHash = false, focus = false } = {}) {
    current = Math.max(0, Math.min(stages.length - 1, index));
    stages.forEach((stage, i) => {
      stage.hidden = i !== current;
      stage.classList.toggle("stage-enter", i === current);
    });
    links.forEach((link, i) => {
      if (i === current) link.setAttribute("aria-current", "step");
      else link.removeAttribute("aria-current");
    });
    document.getElementById("stage-counter").textContent =
      `STAGE ${String(current + 1).padStart(2, "0")} / 09`;
    document.getElementById("previous-stage").disabled = current === 0;
    document.getElementById("next-stage").disabled =
      current === stages.length - 1;
    document.getElementById("slide-announcement").textContent =
      `Stage ${current + 1} of 9: ${stages[current].querySelector("h2").textContent}`;
    if (updateHash) history.replaceState(null, "", `#${stages[current].id}`);
    updateProgress();
    if (focus) shell.focus({ preventScroll: true });
  }
  document.body.classList.add("is-slideshow");
  links.forEach((link, i) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showStage(i, { updateHash: true });
    });
  });
  document
    .getElementById("previous-stage")
    .addEventListener("click", () =>
      showStage(current - 1, { updateHash: true, focus: true }),
    );
  document
    .getElementById("next-stage")
    .addEventListener("click", () =>
      showStage(current + 1, { updateHash: true, focus: true }),
    );
  shell.addEventListener("keydown", (event) => {
    if (
      event.target !== shell ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      showStage(current + (event.key === "ArrowRight" ? 1 : -1), {
        updateHash: true,
        focus: true,
      });
    }
  });
  document.getElementById("complete-stage").addEventListener("click", () => {
    const id = stages[current].id;
    if (state.complete.includes(id))
      state.complete = state.complete.filter((item) => item !== id);
    else state.complete.push(id);
    save();
    updateProgress();
    document.getElementById("slide-announcement").textContent =
      `Stage ${current + 1} ${state.complete.includes(id) ? "marked complete" : "marked incomplete"}.${storageAvailable ? "" : " Not saved; storage unavailable."}`;
  });
  function stageFromHash() {
    const index = stages.findIndex((stage) => `#${stage.id}` === location.hash);
    if (index >= 0) showStage(index);
  }
  window.addEventListener("hashchange", stageFromHash);
  const initial = stages.findIndex((stage) => `#${stage.id}` === location.hash);
  showStage(initial < 0 ? 0 : initial);
  // A first-day preview only: no authentication request or saved name.
  const computer = document.getElementById("demo-computer");
  const demoViews = [...document.querySelectorAll("[data-demo-view]")];
  const terminal = document.getElementById("boot-terminal");
  let bootRun = 0;
  let teammate = "teammate";
  function setDemoView(view) {
    computer.dataset.mode = view;
    demoViews.forEach((panel) => {
      panel.hidden = panel.dataset.demoView !== view;
    });
  }
  function finishBoot() {
    bootRun += 1;
    document.getElementById("demo-welcome").textContent =
      `You’re in, ${teammate}.`;
    try {
      sessionStorage.setItem("byteback.desk.ready", "yes");
    } catch {
      /* Continue without session storage. */
    }
    setDemoView("ready");
    document.getElementById("demo-welcome").focus({ preventScroll: true });
  }
  document
    .getElementById("demo-login")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      teammate =
        document.getElementById("demo-name").value.trim().slice(0, 24) ||
        "teammate";
      const run = ++bootRun;
      terminal.textContent = "";
      document.getElementById("boot-fill").style.width = "0%";
      setDemoView("boot");
      document.getElementById("skip-boot").focus({ preventScroll: true });
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        finishBoot();
        return;
      }
      const lines = [
        {
          text: "> signing in to your practice desktop...",
          message: "Coffee? Check. Curiosity? Check.",
          progress: "30%",
        },
        {
          text: "> opening roadmap + Kanban board...",
          message: "Nine little missions. You’ve got this.",
          progress: "65%",
        },
        {
          text: "> you’re in. pick your first mission.",
          message: "Your workspace is ready.",
          progress: "100%",
        },
      ];
      for (const line of lines) {
        if (run !== bootRun) return;
        document.getElementById("boot-message").textContent = line.message;
        for (const character of line.text) {
          await new Promise((resolve) => window.setTimeout(resolve, 18));
          if (run !== bootRun) return;
          terminal.textContent += character;
        }
        terminal.textContent += "\n";
        document.getElementById("boot-fill").style.width = line.progress;
        await new Promise((resolve) => window.setTimeout(resolve, 220));
      }
      if (run === bootRun) finishBoot();
    });
  document.getElementById("skip-boot").addEventListener("click", finishBoot);
  document.getElementById("replay-boot").addEventListener("click", () => {
    bootRun += 1;
    setDemoView("login");
    try {
      sessionStorage.removeItem("byteback.desk.ready");
    } catch {
      /* Optional. */
    }
    document.getElementById("demo-name").focus({ preventScroll: true });
  });
  const workspace = document.querySelector(".workspace-layout");
  const appButtons = [...document.querySelectorAll("[data-app]")];
  function openApp(app, focus = false) {
    workspace.dataset.activeApp = app;
    appButtons.forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.app === app)),
    );
    if (computer.dataset.mode !== "ready") finishBoot();
    if (focus) {
      const target = document.getElementById(
        app === "kanban"
          ? "kanban-title"
          : app === "feedback"
            ? "feedback-title"
            : "slide-shell",
      );
      if (app === "kanban") target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
  appButtons.forEach((button) =>
    button.addEventListener("click", () => openApp(button.dataset.app, true)),
  );
  document.querySelectorAll('a[href="#kanban"]').forEach((link) =>
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openApp("kanban", true);
    }),
  );
  document
    .querySelector(".skip-link")
    .addEventListener("click", () => openApp("roadmap", true));
  window.addEventListener("hashchange", () => {
    if (location.hash === "#kanban") openApp("kanban");
    else if (stages.some((stage) => `#${stage.id}` === location.hash))
      openApp("roadmap");
  });
  try {
    if (
      sessionStorage.getItem("byteback.desk.ready") === "yes" ||
      location.hash
    )
      finishBoot();
  } catch {
    /* The sign-in remains usable without storage. */
  }
  if (location.hash === "#kanban") openApp("kanban");
  const cheers = [
    "You know what’s under the hood.",
    "Your launchpad is ready.",
    "One card at a time. You’ve got this.",
    "Good code travels with a reviewer.",
    "Feedback has a home now.",
    "Fast sidekick. Thoughtful human.",
    "Fewer oops. More confidence.",
    "Test drive: complete.",
    "Nine stops. You made it!",
  ];
  document.getElementById("complete-stage").addEventListener("click", () => {
    document.getElementById("workspace-toast").textContent =
      state.complete.includes(stages[current].id)
        ? cheers[current]
        : "Check removed. Take another look when you’re ready.";
  });
  const board = document.getElementById("kanban-board");
  function renderBoard() {
    board.replaceChildren();
    const taskStatus = (id) =>
      statuses.includes(state.tasks[id]) ? state.tasks[id] : "Ready";
    statuses.forEach((status) => {
      const column = document.createElement("section");
      column.className = "board-column";
      column.setAttribute("aria-label", status);
      const heading = document.createElement("h3");
      heading.append(document.createTextNode(status));
      const matching = tasks.filter((task) => taskStatus(task.id) === status);
      const count = document.createElement("span");
      count.textContent = String(matching.length);
      heading.append(count);
      column.append(heading);
      matching.forEach((task) => {
        const card = document.createElement("article");
        card.className = "task-card";
        const note = document.createElement("small");
        note.textContent = task.note;
        const title = document.createElement("p");
        title.textContent = task.title;
        const select = document.createElement("select");
        select.id = `task-${task.id}`;
        select.setAttribute("aria-label", `Status for ${task.title}`);
        statuses.forEach((value) => {
          const option = document.createElement("option");
          option.textContent = value;
          option.value = value;
          option.selected = value === status;
          select.append(option);
        });
        select.addEventListener("change", () => {
          state.tasks[task.id] = select.value;
          save();
          renderBoard();
          document
            .getElementById(`task-${task.id}`)
            .focus({ preventScroll: true });
          document.getElementById("board-status").textContent =
            `${task.title} → ${state.tasks[task.id]}. ${storageAvailable ? "Saved on this device." : "Storage unavailable; kept for this visit only."}`;
        });
        card.append(note, title, select);
        column.append(card);
      });
      board.append(column);
    });
  }
  renderBoard();
  document
    .getElementById("add-task-form")
    .addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById("new-task");
      const title = input.value.trim();
      if (!title) {
        input.focus();
        return;
      }
      if (state.customTasks.length >= 50) {
        document.getElementById("board-status").textContent =
          "This personal board supports 50 added tasks. Track more work in GitHub Issues.";
        return;
      }
      const task = {
        id: `custom-${crypto.randomUUID()}`,
        title: title.slice(0, 100),
        note: "YOUR TASK",
      };
      tasks.push(task);
      state.customTasks.push(task);
      save();
      renderBoard();
      input.value = "";
      input.focus();
      document.getElementById("board-status").textContent =
        `${task.title} added to Ready. ${storageAvailable ? "Saved on this device." : "Kept for this visit only."}`;
    });
  if (!storageAvailable)
    document.getElementById("board-status").textContent =
      "Storage unavailable. Progress is kept for this visit only.";
  document.querySelectorAll(".copy-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button.parentElement.querySelector("pre code");
      try {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = "Copied ✓";
      } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(code);
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = "Selected — press Ctrl/Cmd+C";
      }
      window.setTimeout(() => {
        button.textContent = "Copy commands";
      }, 3500);
    });
  });
  let printDetails = [];
  window.addEventListener("beforeprint", () => {
    printDetails = [...document.querySelectorAll("details")].map((detail) => [
      detail,
      detail.open,
    ]);
    stages.forEach((stage) => {
      stage.hidden = false;
    });
    printDetails.forEach(([detail]) => {
      detail.open = true;
    });
  });
  window.addEventListener("afterprint", () => {
    printDetails.forEach(([detail, open]) => {
      detail.open = open;
    });
    showStage(current);
  });
  document
    .getElementById("print-guide")
    .addEventListener("click", () => window.print());
})();
