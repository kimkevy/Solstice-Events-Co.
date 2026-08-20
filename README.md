# Swift Check-in

Below is a structured prompt designed to guide an AI or developer through producing a system design and implementation plan for Solstice Events Co.




Case Study Prompt

Role & Task




Act as a Principal Systems Architect and Full-Stack Developer. Design and implement a updated, asynchronous check-in system for Solstice Events Co. following a vendor API deprecation. You will replace the synchronous REST implementation with an event-driven architecture using RabbitMQ (or Apache Kafka / AWS SQS) as the message broker.




Key Requirements & Constraints

Asynchronous Architecture:




Publish a PrintRequested message to the vendor's queue instead of making a synchronous HTTP call.

Expose a secure webhook endpoint to receive the vendor's asynchronous PrintCompleted callback.

UI State Management:




The check-in kiosk UI must immediately transition to a Pending / Printing state upon scan.

The UI must dynamically update to Checked In only after receiving the webhook completion event (e.g., via WebSockets, Server-Sent Events, or polling).

Concurrency & Idempotency (Duplicate-Scan Protection):




Prevent duplicate badge prints for attendees who are already checked in or have a print job currently pending.

Handle out-of-order webhook callbacks or rapid duplicate scans safely without generating extra print requests.

Required Deliverables

1. Architecture & Flow Diagram: Describe or diagram the end-to-end data flow (Attendee Scan → Queue Publish → Vendor Webhook Callback → UI State Update).

2. API & Data Models: Define the webhook payload schemas, event payload structures, and attendee state machine transition rules (e.g., NOT_CHECKED_IN $\rightarrow$ CHECK_IN_PENDING $\rightarrow$ CHECKED_IN).

3. Code Implementation: Provide a minimal working implementation (Node.js/Python/Go) demonstrating:




The scan handler publishing to the message queue.

The webhook callback handler updating the attendee status.

Idempotency checks to block duplicate scans during CHECK_IN_PENDING or CHECKED_IN states.

4. Test Suite Strategy: Outline test cases verifying:




Attendee A: First-time check-in succeeds.

Attendee B: Webhook arrives delayed/out of order.

Attendee C (Duplicate Scan): Rapid second scan while state is PENDING or CHECKED_IN returns a non-duplicate response.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6b730ca0-9415-4ef2-8042-da5b1eda5559).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
