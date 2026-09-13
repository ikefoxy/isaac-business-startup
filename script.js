"use strict";

// Everything runs in the browser. This prototype never sends form data.
(() => {
  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector("#primary-nav");
  const mobileQuery = window.matchMedia("(max-width: 900px)");

  function setMenu(open, returnFocus = false) {
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
    navigation.classList.toggle("is-open", open);
    document.body.classList.toggle("menu-open", open);
    if (returnFocus) menuButton.focus();
  }

  menuButton.addEventListener("click", () => {
    setMenu(menuButton.getAttribute("aria-expanded") !== "true");
  });

  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenu(false);
  });

  document.addEventListener("keydown", (event) => {
    if (menuButton.getAttribute("aria-expanded") !== "true") return;
    if (event.key === "Escape") {
      event.preventDefault();
      setMenu(false, true);
    }
    if (event.key === "Tab") {
      const lastLink = navigation.querySelector("a:last-child");
      if (event.shiftKey && document.activeElement === menuButton) {
        event.preventDefault();
        lastLink.focus();
      } else if (!event.shiftKey && document.activeElement === lastLink) {
        event.preventDefault();
        menuButton.focus();
      }
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".nav-shell")) setMenu(false);
  });

  mobileQuery.addEventListener("change", () => {
    if (!mobileQuery.matches) setMenu(false);
  });

  document.documentElement.classList.add("nav-enhanced");
  menuButton.hidden = false;

  const form = document.querySelector("#contact-form");
  const successPanel = document.querySelector("#form-success");
  const errorSummary = document.querySelector("#form-error-summary");
  const interest = document.querySelector("#interest");
  const deleteButton = document.querySelector("#delete-request");
  const storageKey = "byu-byteback-prototype-request";
  const requiredFields = [...form.querySelectorAll("[required]")];
  let submissionAttempted = false;

  function fieldError(field) {
    const value = field.value.trim();
    if (!value) {
      return {
        "full-name": "Please enter your name.",
        email: "Please enter your email address.",
        interest: "Please select what you’re interested in.",
        message: "Please add a short message.",
      }[field.id];
    }
    if (
      field.id === "email" &&
      (field.validity.typeMismatch || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    ) {
      return "Enter a valid email, such as you@example.com.";
    }
    if (field.maxLength > 0 && value.length > field.maxLength) {
      return `Please use ${field.maxLength} characters or fewer.`;
    }
    return "";
  }

  function validateField(field) {
    const message = fieldError(field);
    document.getElementById(`${field.id}-error`).textContent = message;
    if (message) field.setAttribute("aria-invalid", "true");
    else field.removeAttribute("aria-invalid");
    return !message;
  }

  function clearSummary() {
    errorSummary.hidden = true;
    errorSummary.textContent = "";
  }

  function showError(message) {
    errorSummary.textContent = message;
    errorSummary.hidden = false;
  }

  function showForm() {
    form.reset();
    submissionAttempted = false;
    clearSummary();
    for (const field of requiredFields) {
      field.removeAttribute("aria-invalid");
      document.getElementById(`${field.id}-error`).textContent = "";
    }
    successPanel.hidden = true;
    form.hidden = false;
  }

  for (const field of requiredFields) {
    field.addEventListener("blur", () => {
      if (submissionAttempted || field.value) validateField(field);
    });
    field.addEventListener(
      field.tagName === "SELECT" ? "change" : "input",
      () => {
        if (submissionAttempted || field.hasAttribute("aria-invalid"))
          validateField(field);
        if (requiredFields.every((item) => !fieldError(item))) clearSummary();
      },
    );
  }

  // Donation and partnership links enter the same form with the right intent.
  document.querySelectorAll("[data-interest]").forEach((link) => {
    link.addEventListener("click", () => {
      if (form.hidden) showForm();
      interest.value = link.dataset.interest;
      validateField(interest);
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submissionAttempted = true;
    const invalidFields = requiredFields.filter(
      (field) => !validateField(field),
    );
    if (invalidFields.length) {
      showError("Please check the highlighted fields below.");
      invalidFields[0].focus();
      return;
    }

    clearSummary();
    const request = {
      prototype: true,
      savedAt: new Date().toISOString(),
      fullName: form.elements.fullName.value.trim(),
      email: form.elements.email.value.trim(),
      organization: form.elements.organization.value.trim(),
      interest: interest.value,
      message: form.elements.message.value.trim(),
    };

    try {
      // Keep only the latest request, avoiding an accumulating store of personal data.
      window.localStorage.setItem(storageKey, JSON.stringify(request));
    } catch {
      showError(
        "This browser couldn’t save your request locally. Allow local storage for this site and try again. Nothing was sent or saved.",
      );
      errorSummary.scrollIntoView({ block: "center", behavior: "auto" });
      return;
    }

    document.querySelector("#saved-interest").textContent = request.interest;
    document.querySelector("#success-title").textContent =
      "Your request is saved on this device.";
    document.querySelector("#deletion-status").textContent = "";
    deleteButton.hidden = false;
    form.hidden = true;
    successPanel.hidden = false;
    successPanel.focus({ preventScroll: true });
    // The form is tall on phones; keep the confirmation in view after it shrinks.
    successPanel.scrollIntoView({ block: "center", behavior: "auto" });
  });

  document.querySelector("#request-another").addEventListener("click", () => {
    showForm();
    document.querySelector("#full-name").focus({ preventScroll: true });
    form.scrollIntoView({ block: "start", behavior: "auto" });
  });

  deleteButton.addEventListener("click", () => {
    try {
      window.localStorage.removeItem(storageKey);
      document.querySelector("#deletion-status").textContent =
        "Your saved request has been deleted from this browser.";
      document.querySelector("#success-title").textContent =
        "Your request has been deleted.";
      deleteButton.hidden = true;
      document.querySelector("#request-another").focus({ preventScroll: true });
    } catch {
      document.querySelector("#deletion-status").textContent =
        "This browser couldn’t delete the request. You can remove it by clearing this site’s browser data.";
    }
  });

  // Native validation remains available in the markup; JavaScript adds inline guidance.
  form.noValidate = true;
  form.querySelector("[type='submit']").disabled = false;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if ("IntersectionObserver" in window && !reducedMotion.matches) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -20px 0px" },
    );
    document.querySelectorAll("[data-reveal]").forEach((element) => {
      element.classList.add("reveal-ready");
      observer.observe(element);
    });
  }
})();
