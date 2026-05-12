# SiglaCast

Advanced voting and community application scaffold for Davao Oriental State University events.

## Integrative Programming Topics Covered

1. **OOP Principles**
   - Inheritance: `User` -> `Student`, `Admin`
   - Encapsulation: private fields (`#id`, `#permissions`)
   - Polymorphism: `VoteStrategy` with `SingleVoteStrategy` and `WeightedVoteStrategy`

2. **Messaging Broker (Kafka/RabbitMQ)**
   - Broker abstraction + implementations
   - Queue/topic publish + consume hooks for votes and posts

3. **XML / XML Parsing**
   - `GET /api/xml/events.xml`
   - `POST /api/xml/parse`

4. **XSL / XSLT**
   - `GET /api/xml/events.html` transforms XML using `backend/src/xslt/events.xsl`

5. **Scripting Languages**
   - JavaScript backend + admin scripts
   - PowerShell and Bash setup scripts

6. **Scripting for System Administration**
   - `backend/scripts/admin/setup-env.ps1`
   - `backend/scripts/admin/setup-env.sh`

7. **Advanced Scripting Techniques**
   - `backend/scripts/admin/monitor-queue.js` with CLI argument support and live terminal updates

## UI Theme

The web app uses a **blue + yellow + white** design system as requested.

## Run

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```
