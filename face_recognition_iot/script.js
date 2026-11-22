"use strict";

const cameraStatus = document.getElementById("cameraStatus");
const cameraDot = document.getElementById("cameraDot");
const cameraFeed = document.getElementById("cameraFeed");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const faceStatus = document.getElementById("faceStatus");
const stationMessage = document.getElementById("stationMessage");
const timeInButton = document.getElementById("timeInButton");
const timeOutButton = document.getElementById("timeOutButton");
const recognitionCard = document.getElementById("recognitionCard");
const resultEyebrow = document.getElementById("resultEyebrow");
const resultTitle = document.getElementById("resultTitle");
const resultMark = document.getElementById("resultMark");
const personDetails = document.getElementById("personDetails");
const personSchoolId = document.getElementById("personSchoolId");
const personName = document.getElementById("personName");
const personRole = document.getElementById("personRole");
const personDepartment = document.getElementById("personDepartment");
const recordedTime = document.getElementById("recordedTime");
const confirmationActions = document.getElementById("confirmationActions");
const confirmButton = document.getElementById("confirmButton");
const cancelButton = document.getElementById("cancelButton");
const borrowBookButton = document.getElementById("borrowBookButton");
const returnBookButton = document.getElementById("returnBookButton");
const bookFlowPanel = document.getElementById("bookFlowPanel");
const bookFlowTitle = document.getElementById("bookFlowTitle");
const bookFlowMessage = document.getElementById("bookFlowMessage");
const borrowerLookupForm = document.getElementById("borrowerLookupForm");
const borrowerSchoolId = document.getElementById("borrowerSchoolId");
const bookBorrowerDetails = document.getElementById("bookBorrowerDetails");
const bookLoans = document.getElementById("bookLoans");
const bookLoansList = document.getElementById("bookLoansList");
const bookScanPanel = document.getElementById("bookScanPanel");
const bookBarcodeLabel = document.getElementById("bookBarcodeLabel");
const bookBarcodeInput = document.getElementById("bookBarcodeInput");
const confirmBookReturnButton = document.getElementById("confirmBookReturnButton");

let feedRetryTimer = null;
let bookFlowMode = "";
let bookFlowBorrower = null;
let activeBorrowedBooks = [];
let scannedReturnBook = null;

function formatManilaTimestamp(value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(timestamp);
}

async function request(path, options) {
  const response = await fetch(path, Object.assign({
    headers: { "Content-Type": "application/json" }
  }, options || {}));
  const result = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(result.error || "The station request failed.");
  return result;
}

function setCameraStatus(status, message) {
  // Only hide the live video when the camera itself has a problem.
  // A backend_error means the library server is slow, but the camera still works.
  const feedProblem = ["starting", "camera_error", "error", "stopped"].includes(status);
  cameraStatus.textContent = message;
  cameraDot.classList.toggle("ready", status === "active");
  cameraDot.classList.toggle("error", status === "error" || status === "camera_error" || status === "backend_error");
  cameraPlaceholder.style.display = feedProblem ? "grid" : "none";
  if (feedProblem) cameraPlaceholder.textContent = message;
}

function fillPerson(person) {
  personSchoolId.textContent = person.school_id || "-";
  personName.textContent = person.name || "-";
  personRole.textContent = person.role || "-";
  personDepartment.textContent = person.department || "-";
}

function showErrorCard(title, message, dismissible) {
  recognitionCard.hidden = false;
  recognitionCard.className = "recognition-card error";
  resultEyebrow.textContent = "ATTENDANCE NOT RECORDED";
  resultTitle.textContent = title;
  resultMark.textContent = "!";
  personDetails.hidden = true;
  recordedTime.hidden = true;
  recordedTime.textContent = "";
  // A failed confirmation gets a Dismiss button so the screen never gets stuck.
  confirmationActions.hidden = !dismissible;
  confirmButton.hidden = true;
  cancelButton.textContent = "Dismiss";
  stationMessage.textContent = message;
  stationMessage.className = "station-message error";
}

function renderStation(state) {
  setCameraStatus(state.camera_status, state.camera_status === "active" ? "Camera active" : state.message);

  const action = state.selected_action;
  timeInButton.setAttribute("aria-pressed", String(action === "time_in"));
  timeOutButton.setAttribute("aria-pressed", String(action === "time_out"));

  faceStatus.textContent = {
    ready: "Waiting for a face",
    recognized: "Face recognized",
    unknown: "Face not recognized",
    multiple_faces: "One person at a time",
    recorded: "Attendance recorded",
    error: "Attendance error"
  }[state.face_status] || "Waiting for a face";
  faceStatus.className = "face-status";
  if (state.face_status === "recognized" || state.face_status === "recorded") faceStatus.classList.add("detected");
  if (state.face_status === "unknown" || state.face_status === "multiple_faces" || state.face_status === "error") {
    faceStatus.classList.add("unknown");
  }

  if (state.result) {
    const isTimeIn = state.result.action === "time_in";
    recognitionCard.hidden = false;
    recognitionCard.className = "recognition-card success";
    resultEyebrow.textContent = isTimeIn ? "TIME-IN SUCCESS" : "TIME-OUT SUCCESS";
    resultTitle.textContent = "Attendance recorded";
    resultMark.textContent = "✓";
    personDetails.hidden = false;
    fillPerson(state.result.person);
    recordedTime.hidden = false;
    recordedTime.textContent = formatManilaTimestamp(state.result.timestamp);
    confirmationActions.hidden = true;
    stationMessage.textContent = state.message;
    stationMessage.className = "station-message success";
    return;
  }

  if (state.face_status === "unknown") {
    showErrorCard("Face not recognized", state.message || "No registered person was found. Please contact the library administrator.", false);
    return;
  }

  if (state.face_status === "multiple_faces") {
    showErrorCard("One person at a time", state.message, false);
    return;
  }

  if (state.camera_status === "error") {
    showErrorCard("Station unavailable", state.message, false);
    return;
  }

  if (state.face_status === "error") {
    showErrorCard("Could not record attendance", state.message, true);
    return;
  }

  if (state.pending_person) {
    recognitionCard.hidden = false;
    recognitionCard.className = "recognition-card";
    resultEyebrow.textContent = "FACE RECOGNIZED";
    resultTitle.textContent = "Confirm attendance";
    resultMark.textContent = "?";
    personDetails.hidden = false;
    fillPerson(state.pending_person);
    recordedTime.hidden = true;
    confirmationActions.hidden = false;
    confirmButton.hidden = false;
    cancelButton.textContent = "Cancel";
    confirmButton.disabled = !state.can_confirm;
    confirmButton.textContent = action === "time_in" ? "Confirm Time-in" : (action === "time_out" ? "Confirm Time-out" : "Select an action first");
    stationMessage.textContent = action ? state.action_message : "Choose Time-in or Time-out, then confirm this person.";
    stationMessage.className = state.action_message && (
      state.action_message.startsWith("Already Timed-in") ||
      state.action_message.startsWith("Time-out cannot") ||
      state.action_message.startsWith("Inactive person")
    ) ? "station-message error" : "station-message";
    return;
  }

  recognitionCard.hidden = true;
  stationMessage.textContent = state.message || "Select Time-in or Time-out before confirming attendance.";
  stationMessage.className = "station-message";
}

async function refreshStation() {
  try {
    renderStation(await request("/api/state"));
  } catch (error) {
    setCameraStatus("error", error.message);
    stationMessage.textContent = error.message;
    stationMessage.className = "station-message error";
  }
}

async function selectAction(action) {
  try {
    renderStation(await request("/api/action", {
      method: "POST",
      body: JSON.stringify({ action: action })
    }));
  } catch (error) {
    stationMessage.textContent = error.message;
    stationMessage.className = "station-message error";
  }
}

timeInButton.addEventListener("click", function () { selectAction("time_in"); });
timeOutButton.addEventListener("click", function () { selectAction("time_out"); });

confirmButton.addEventListener("click", async function () {
  confirmButton.disabled = true;
  try {
    renderStation(await request("/api/confirm", { method: "POST", body: "{}" }));
  } catch (error) {
    stationMessage.textContent = error.message;
    stationMessage.className = "station-message error";
    await refreshStation();
  }
});

cancelButton.addEventListener("click", async function () {
  try {
    renderStation(await request("/api/cancel", { method: "POST", body: "{}" }));
  } catch (error) {
    stationMessage.textContent = error.message;
    stationMessage.className = "station-message error";
  }
});

function setBookFlowMessage(message, kind) {
  bookFlowMessage.textContent = message || "";
  bookFlowMessage.className = "book-flow-message" + (kind ? " " + kind : "");
}

function startBookFlow(mode) {
  bookFlowMode = mode;
  bookFlowBorrower = null;
  activeBorrowedBooks = [];
  scannedReturnBook = null;
  bookFlowPanel.hidden = false;
  bookFlowTitle.textContent = mode === "borrow" ? "Borrow Book" : "Return Book";
  borrowerLookupForm.reset();
  bookBorrowerDetails.hidden = true;
  bookLoans.hidden = true;
  bookScanPanel.hidden = true;
  confirmBookReturnButton.hidden = true;
  setBookFlowMessage(
    mode === "borrow"
      ? "Enter the borrower's School ID to look up their information."
      : "Enter the borrower's School ID to view their active loans."
  );
  borrowerSchoolId.focus();
}

function fillBookBorrower(borrower) {
  bookBorrowerDetails.hidden = false;
  document.getElementById("bookBorrowerSchoolId").textContent = borrower.school_id || "-";
  document.getElementById("bookBorrowerName").textContent = borrower.name || "-";
  document.getElementById("bookBorrowerRole").textContent = borrower.role || "-";
  document.getElementById("bookBorrowerDepartment").textContent = borrower.department || "-";
  document.getElementById("bookBorrowerEmail").textContent = borrower.institutional_email || "-";
}

function renderBorrowedBooks(loans, hasActiveTimeIn) {
  bookLoansList.replaceChildren();
  loans.forEach(function (loan) {
    const item = document.createElement("li");
    item.textContent = loan.title + " · Barcode " + loan.barcode +
      " · Due " + loan.due_date;
    bookLoansList.appendChild(item);
  });
  bookLoans.hidden = false;
  document.getElementById("startReturnScanButton").disabled = loans.length === 0 || !hasActiveTimeIn;
  document.getElementById("startReturnScanButton").textContent =
    !hasActiveTimeIn && loans.length
      ? "Time In required before return"
      : loans.length ? "Start Return Scan" : "No borrowed books to return";
}

async function lookupBookBorrower() {
  const schoolId = borrowerSchoolId.value.trim();
  if (!schoolId) {
    setBookFlowMessage("Enter a borrower School ID.", "error");
    return;
  }
  setBookFlowMessage("Looking up School ID...");
  bookScanPanel.hidden = true;
  confirmBookReturnButton.hidden = true;
  try {
    const result = await request(
      "/api/book-borrowers?school_id=" + encodeURIComponent(schoolId)
    );
    bookFlowBorrower = result.borrower;
    activeBorrowedBooks = result.borrowed_books || [];
    fillBookBorrower(bookFlowBorrower);
    if (bookFlowMode === "borrow") {
      if (bookFlowBorrower.status !== "active") {
        setBookFlowMessage("Inactive people cannot borrow books.", "error");
        return;
      }
      if (!bookFlowBorrower.has_active_time_in) {
        setBookFlowMessage(
          "Time In is required before borrowing. Record attendance using face recognition, then try again.",
          "error"
        );
        return;
      }
      bookBarcodeLabel.textContent = "Scan the Book Barcode.";
      setBookFlowMessage("Scan the Book Barcode.");
      bookScanPanel.hidden = false;
      bookBarcodeInput.focus();
      return;
    }

    renderBorrowedBooks(activeBorrowedBooks, bookFlowBorrower.has_active_time_in);
    if (!bookFlowBorrower.has_active_time_in) {
      setBookFlowMessage(
        "Time In is required before returning a book. Record attendance using face recognition, then try again.",
        "error"
      );
      return;
    }
    setBookFlowMessage(
      activeBorrowedBooks.length
        ? "Review the borrowed books, then start a return scan."
        : "This borrower has no active book loans.",
      activeBorrowedBooks.length ? "" : "error"
    );
  } catch (error) {
    bookFlowBorrower = null;
    activeBorrowedBooks = [];
    bookBorrowerDetails.hidden = true;
    bookLoans.hidden = true;
    setBookFlowMessage(error.message, "error");
  }
}

async function scanBookForTransaction() {
  const barcode = bookBarcodeInput.value.trim();
  if (!bookFlowBorrower || !barcode) {
    setBookFlowMessage("Enter or scan a barcode for the verified borrower.", "error");
    return;
  }
  confirmBookReturnButton.hidden = true;
  scannedReturnBook = null;
  setBookFlowMessage("Checking the scanned barcode...");
  try {
    const result = await request(
      "/api/books/barcode?value=" + encodeURIComponent(barcode)
    );
    const book = result.book;
    if (bookFlowMode === "borrow") {
      if (Number(book.available_quantity) < 1) {
        throw new Error("There are no available copies of this book.");
      }
      const saved = await request("/api/book-transactions/borrow", {
        method: "POST",
        body: JSON.stringify({ school_id: bookFlowBorrower.school_id, barcode: book.barcode })
      });
      setBookFlowMessage(
        bookFlowBorrower.name + " borrowed " + book.title +
          " (barcode " + book.barcode + ").",
        "success"
      );
      bookBarcodeInput.value = "";
      return saved;
    }

    const loan = activeBorrowedBooks.find(function (item) {
      return item.barcode === book.barcode;
    });
    if (!loan) {
      throw new Error("This barcode does not match a book currently borrowed by this School ID.");
    }
    scannedReturnBook = book;
    confirmBookReturnButton.hidden = false;
    setBookFlowMessage(
      "Barcode matched " + book.title + ". Confirm the return to complete the transaction."
    );
  } catch (error) {
    setBookFlowMessage(error.message, "error");
  }
}

borrowBookButton.addEventListener("click", function () { startBookFlow("borrow"); });
returnBookButton.addEventListener("click", function () { startBookFlow("return"); });
document.getElementById("closeBookFlowButton").addEventListener("click", function () {
  bookFlowPanel.hidden = true;
  bookFlowMode = "";
});
borrowerLookupForm.addEventListener("submit", function (event) {
  event.preventDefault();
  lookupBookBorrower();
});
document.getElementById("startReturnScanButton").addEventListener("click", function () {
  if (!activeBorrowedBooks.length) return;
  bookBarcodeInput.value = "";
  confirmBookReturnButton.hidden = true;
  bookScanPanel.hidden = false;
  bookBarcodeLabel.textContent = "Scan the Book Barcode to Return.";
  setBookFlowMessage("Scan the Book Barcode to Return.");
  bookBarcodeInput.focus();
});
document.getElementById("scanBookButton").addEventListener("click", scanBookForTransaction);
bookBarcodeInput.addEventListener("keydown", function (event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  scanBookForTransaction();
});
confirmBookReturnButton.addEventListener("click", async function () {
  if (!bookFlowBorrower || !scannedReturnBook) return;
  confirmBookReturnButton.disabled = true;
  try {
    const result = await request("/api/book-transactions/return", {
      method: "POST",
      body: JSON.stringify({
        school_id: bookFlowBorrower.school_id,
        barcode: scannedReturnBook.barcode
      })
    });
    const returnedTitle = result.book.title;
    const borrowerName = result.borrower.name;
    bookBarcodeInput.value = "";
    scannedReturnBook = null;
    confirmBookReturnButton.hidden = true;
    await lookupBookBorrower();
    setBookFlowMessage(
      returnedTitle + " was returned by " + borrowerName +
        (result.return_date ? " at " + formatManilaTimestamp(result.return_date) : "") + ".",
      "success"
    );
  } catch (error) {
    setBookFlowMessage(error.message, "error");
  } finally {
    confirmBookReturnButton.disabled = false;
  }
});

// Live video: the <img> points at the MJPEG stream (/camera_feed).
// If the stream drops (server restart, network blip), reconnect automatically.
function connectFeed() {
  cameraFeed.src = "/camera_feed?t=" + Date.now();
}

cameraFeed.addEventListener("load", function () {
  cameraPlaceholder.style.display = "none";
});
cameraFeed.addEventListener("error", function () {
  cameraPlaceholder.style.display = "grid";
  cameraPlaceholder.textContent = "Camera feed unavailable. Reconnecting...";
  if (feedRetryTimer === null) {
    feedRetryTimer = window.setTimeout(function () {
      feedRetryTimer = null;
      connectFeed();
    }, 2000);
  }
});

connectFeed();
refreshStation();
window.setInterval(refreshStation, 500);
