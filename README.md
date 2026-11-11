# Smart Library System

Web-based library system for Pateros Technological College with two main features:

1. **Face-recognition attendance** - a Raspberry Pi with a Camera Module recognizes registered people and records Time-in / Time-out.
2. **Barcode-based book transactions** - librarians scan book barcodes to borrow and return books.

The existing HTML and CSS are served by Flask, which also provides the API. The database is SQLite by default and PostgreSQL when `DATABASE_URL` is set.

```
Raspberry Pi + Camera --HTTPS + IoT key--> Hostinger VPS (Nginx > Gunicorn > Flask > database)
                                                    ^
Librarian / MIS Admin (any device, any network) -HTTPS
```

## Contents

- [Deploy online (Hostinger VPS + Raspberry Pi)](#deploy-online-hostinger-vps--raspberry-pi) - the normal way to use the system
- [Run locally on Windows](#step-by-step-run-locally-on-windows) - for development and testing only
- [Staff accounts](#development-staff-accounts), [roles](#roles-and-api), [password recovery](#librarian-password-recovery)
- [Face Recognition / IoT](#face-recognition--iot) and [book barcodes and borrowing](#book-barcodes-and-borrowing)

## Project structure

| Path | Purpose |
|---|---|
| `backend/` | Flask app (`app.py`), database layer (`database.py`), server-side face enrollment |
| `LogIn.html`, `welcome.html`, ... | Public pages (login, email verification, password change) |
| `MIS_ADMIN/`, `LIBRARIAN/` | Role-specific dashboards, attendance (Time In/Out), book transactions, reports |
| `app.js` | Shared front-end code; calls the API with relative paths (`/api/...`), so no URL changes are needed when deployed |
| `face_recognition_iot/` | Camera station that runs on the Raspberry Pi (or a PC webcam for testing) |
| `face_recognition_iot/raspberry_pi/` | Pi setup script, systemd service, full-screen browser (kiosk) script |
| `deploy/hostinger/` | VPS setup script, Nginx and systemd files, backup script, deployment guide |

## Deploy online (Hostinger VPS + Raspberry Pi)

Once deployed, the librarian only needs a browser: nothing has to run on their computer, and the Pi can be on a different network because it only makes outgoing HTTPS connections.

1. **Server:** follow [`deploy/hostinger/DEPLOY_HOSTINGER.md`](deploy/hostinger/DEPLOY_HOSTINGER.md). Hostinger supports Flask only on **VPS** plans (not shared/Web/Cloud hosting). The guide covers the domain, `setup_vps.sh` (installs everything, HTTPS, backups), and moving your existing `smart_library.db` and uploads.
2. **Raspberry Pi:** follow [`face_recognition_iot/raspberry_pi/README_RASPBERRY_PI.md`](face_recognition_iot/raspberry_pi/README_RASPBERRY_PI.md). `setup_pi.sh` installs the station, saves the server address and IoT key, starts it at boot and opens it full-screen in Chromium.
3. **Test everything:** run the full workflow checklist in section 7 of the deployment guide (phone on mobile data, barcode borrow/return, face Time-in/Time-out, reboot test).

Production settings (set on the server by `setup_vps.sh`, see `deploy/hostinger/smart-library.env.example`):

| Variable | Used by | Meaning |
|---|---|---|
| `SMART_LIBRARY_PRODUCTION=1` | server | Production mode (requires a real secret) |
| `SMART_LIBRARY_BEHIND_PROXY=1` | server | Trust Nginx in front of Gunicorn |
| `SMART_LIBRARY_HTTPS=1` | server | HTTPS-only session cookies |
| `SMART_LIBRARY_SECRET` | server | Signs login sessions |
| `SMART_LIBRARY_IOT_KEY` | server and Pi | Shared key the Pi sends as `X-IOT-API-Key`; must be identical on both |
| `SMART_LIBRARY_DATA_DIR`, `SMART_LIBRARY_MODEL_DIR` | server | Where the database, uploads and face models are stored |
| `DATABASE_URL` | server | Optional PostgreSQL instead of SQLite |
| `SMART_LIBRARY_API_URL` | Pi | Your `https://` server address |
| `SMART_LIBRARY_AUTO_ATTENDANCE`, `SMART_LIBRARY_AUTO_COOLDOWN` | Pi | Optional automatic Time-in/Time-out (off by default) |
| `SMART_LIBRARY_CAMERA`, `SMART_LIBRARY_STATION_HOST`, `SMART_LIBRARY_STATION_PORT` | Pi | Camera index; the station page stays on `127.0.0.1:5001` |

Never commit real keys or the server env file. Change the default staff passwords on first sign-in.

## Step-by-step: run locally on Windows

> For development and testing on one PC only. For real use, deploy online (see above) so nothing has to run on the librarian's computer.

You need Python installed. Step 1 (the main system, including barcode borrowing/returning) runs fine on Windows. Step 2 (the camera station) now uses the Raspberry Pi Camera Module through Picamera2, so it runs **on the Raspberry Pi only**; the Windows commands in step 2 are kept for reference and will fail with `No module named 'picamera2'` on a PC. Use two **separate PowerShell terminals** if you do run both, and keep them open. Run all commands below from `C:\SmartLibrarySystem001`.

### 1. Set up and start the Smart Library backend

In PowerShell terminal 1:

```powershell
cd C:\SmartLibrarySystem001
python --version
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Generate a private key for communication between the backend and camera station:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Copy the generated value for use in both terminals. Do not post it publicly or commit it to the repository. In terminal 1, set the key and start the backend:

```powershell
$env:SMART_LIBRARY_IOT_KEY = "paste-the-generated-key-here"
.\.venv\Scripts\python.exe backend\app.py
```

Leave this terminal running. Open [http://127.0.0.1:5000/](http://127.0.0.1:5000/) to use the main system. The SQLite database is `smart_library.db`; startup preserves existing accounts and records.

### 2. Set up and start Face Recognition / IoT (Raspberry Pi only)

> The station code opens the camera with Picamera2 (`face_recognition_iot/camera.py`), which is not available on Windows. To run the station, use the [Raspberry Pi guide](face_recognition_iot/raspberry_pi/README_RASPBERRY_PI.md) and point it at your server. The Windows commands below are the old webcam instructions.

Open PowerShell terminal 2 and run:

```powershell
cd C:\SmartLibrarySystem001
python -m venv face_recognition_iot\.venv
.\face_recognition_iot\.venv\Scripts\python.exe -m pip install -r face_recognition_iot\requirements.txt
$env:SMART_LIBRARY_IOT_KEY = "paste-the-same-generated-key-here"
$env:SMART_LIBRARY_API_URL = "http://127.0.0.1:5000"
.\face_recognition_iot\.venv\Scripts\python.exe face_recognition_iot\app.py
```

Leave this terminal running too. On its first start, the station downloads the YuNet and SFace model files into the ignored `face_recognition_iot\.models` folder; an internet connection is needed for this download. Open [http://127.0.0.1:5001/](http://127.0.0.1:5001/) and wait for the station status to say the camera is ready.

### 3. Sign in and use face attendance

Use the [development staff accounts](#development-staff-accounts) below (an existing database keeps its own accounts and passwords). Sign in as MIS Admin, add or select a person, and upload that person's face image. Then use the camera station, select **Time-in** or **Time-out**, and confirm the action after the person is recognized. Recognition alone does not record attendance.

### 4. Stop the applications

In each PowerShell terminal, press **Ctrl+C**. Stop the camera station first, then the main backend. Starting them again later requires setting the IoT key in both new terminals again; generate a new key if you no longer have the old one, and use that same new value for both services.

### Troubleshooting

- **Station cannot connect to the library API:** Check that terminal 1 is still running and that `SMART_LIBRARY_API_URL` is `http://127.0.0.1:5000`. Make sure both terminals have the identical `SMART_LIBRARY_IOT_KEY`.
- **Camera is unavailable:** On the Pi, see the troubleshooting table in the Raspberry Pi guide (check the ribbon cable, run `rpicam-hello --list-cameras`). The station uses camera `0` by default; set `SMART_LIBRARY_CAMERA` to select another one.
- **Camera stopped returning frames:** The station now retries the camera connection automatically. Wait a few seconds for it to reconnect; if it does not, close other apps using the camera, verify Windows camera permissions and the `SMART_LIBRARY_CAMERA` device index, then restart the station.
- **Models fail to download:** Check the internet connection, then restart the camera station. The model files are downloaded on startup when missing or incomplete.
- **PowerShell says the address is already in use:** Another copy is likely running. Stop it with **Ctrl+C** in its terminal before starting another copy.

The Flask development servers bind to `127.0.0.1` and are for local development only. Production runs Gunicorn behind Nginx with HTTPS; see [Deploy online](#deploy-online-hostinger-vps--raspberry-pi).

## Development staff accounts

These accounts are created when missing with the initial passwords below. Existing account passwords are preserved, and people records remain in their current database IDs.

- MIS Admin: `mis@paterostechnologicalcollege.edu.ph` / `admin123`
- Librarian: `librarian@paterostechnologicalcollege.edu.ph` / `librarian123`

Change these development passwords before exposing the system to a network. In a deployed environment, set a strong `SMART_LIBRARY_SECRET` and use HTTPS (`SMART_LIBRARY_HTTPS=1`).

## Roles and API

MIS Admin and Librarian accounts can use the dashboard, book catalog, borrowing/returns, attendance history, and reports. Only MIS Admins can manage people and system accounts. People records do not receive login passwords.

## Librarian password recovery

Password recovery is handled inside the system and does not use SMTP or external email. From **Forgot Password?**, an active Librarian submits their registered email address. The MIS Admin dashboard polls for recovery requests and provides **View Request**, **Approve**, and **Reject** actions.

The MIS Admin must verify the Librarian in person before approving. After approval, the dashboard displays a six-digit code once for private handoff; the code is not shown in the request list and is valid for 15 minutes. The Librarian enters that code on the verification page and sets a new password of at least eight characters. The code can only be used once. Recovery requests expire after 24 hours if they are not reviewed. Incorrect code submissions are limited, and request creation is rate-limited.

Because this installation has no registered out-of-band channel, code handoff depends on in-person identity verification. Do not approve a request or provide its code based only on the email address in the request. The code is delivered to the authenticated MIS Admin browser only after approval, so it is visible in that approval response; do not copy it into messages, logs, or screenshots.

## Face Recognition / IoT

The main backend stores attendance sessions and face-registration metadata; use `/api/attendance/time-in` and `/api/attendance/time-out` through the camera client. In production the Raspberry Pi sends these requests to the online server over HTTPS with the shared IoT key, so the librarian sees attendance on the dashboard from any device. The Pi downloads registered faces from the server (it refreshes every 30 seconds) and only sends attendance after recognition and confirmation (or automatically if auto mode is turned on). See `face_recognition_iot/README.md` for dependencies, models and camera configuration and `face_recognition_iot/raspberry_pi/README_RASPBERRY_PI.md` for the Pi. Camera frames and downloaded embeddings stay in memory; the main service stores compact face encodings and the uploaded registration image.

## Book barcodes and borrowing

The Book Transactions screens support USB barcode scanners that act like a keyboard: select **Scan Barcode**, scan the label, and press Enter if the scanner does not send Enter automatically. You can also type or paste barcode values. Add Book has separate **Book Number** and **Barcode** values; use **Generate Barcode** when no physical barcode exists. The generated Code 128 barcode can be previewed and printed from the form.

On first startup after this update, the backend migrates the existing SQLite database in place. Existing book numbers are copied into `books.book_number`, unique barcode values are assigned to those rows, and existing transactions receive barcode and borrower-email snapshots. No manual SQL is required. The new database fields are:

- `books.book_number` — unique catalog number, preserving the legacy value previously held in `books.barcode`.
- `books.barcode` — unique physical/generated barcode used for lookup and borrowing.
- `book_transactions.barcode` and `book_transactions.institutional_email` — values captured when a book is borrowed.

To install the barcode renderer with the other backend dependencies, rerun `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`, then start the backend normally. Existing book and transaction IDs and relationships are retained.

### Import book catalog from Excel

Sign in as MIS Admin or Librarian, open **Book Transactions**, and choose **UPLOAD EXCEL**. The importer accepts `.xlsx` and `.xls` files up to 5 MB and up to 5,000 book rows. It scans the first 20 rows of each worksheet for a header row and matches columns by name; extra columns are ignored.

Required columns are **Barcode** (or **Book Number / Barcode**), **Book Title**, **Author**, **Category**, and **Book Count** or **Quantity**. **Book Number** and **Date Published** are optional. If no separate book number is supplied, the barcode is also used as the book number. Each imported book starts with all copies available; this imports catalog inventory, not borrower or borrow/return transaction history.

Rows with missing or oversized required values, a non-whole or negative copy count, or a duplicate barcode/book number are skipped and listed in the import summary. Accepted rows are saved in the existing `books` table and appear in the catalog after the upload completes.

To test the feature locally, start the backend using the Windows instructions above, sign in, and prepare a workbook with columns such as `Book Number / Barcode`, `Category`, `Book Title`, `Author Name`, `Date Published`, and `Book Count`. Include one unique valid book, then try uploading the same file again to confirm duplicates are skipped. A row with a blank title or negative copy count should also be reported as skipped.

### Barcode and institutional-email checks

1. Sign in as MIS Admin or Librarian and open **Book Transactions**.
2. Choose **ADD BOOK**, enter the regular book details, then scan into the Barcode field or enter it manually. Use **Generate Barcode** to create a unique Code 128 label; preview it on screen and choose **Print Barcode** to print.
3. Enter a barcode already used by another book and save (or scan it into the field). The form reports that the barcode is already assigned.
4. In the page search box, choose **Scan Barcode**, scan a registered book, and press Enter. The book information opens; an unknown code reports **Book not found**.
5. Choose **Borrow** on a book. Scan or enter the borrower's School ID and press Enter to retrieve the registered name, program, and institutional email. Scan or enter the book barcode, check its availability, then confirm the due date. The transaction stores the email and barcode snapshots and updates available copies.