# Ostra Data Protection

## Roles and Responsibilities

### Data Controller (Host)
- Determines the purposes and means of processing guest personal data
- Owns the guest data stored in Ostra
- Responsible for complying with GDPR obligations toward guests
- Can set retention periods (30-730 days) for guest data
- Can export or erase guest data through the Ostra interface

### Data Processor (Operator)
- Processes personal data only on documented instructions from the host
- Implements appropriate technical and organizational security measures
- Assists hosts with data subject requests and breach notifications
- Does not use guest data for any purpose other than providing the service
- Returns or deletes data at the end of the contract

## Processing Activities

| Activity | Data Processed | Purpose | Legal Basis |
|----------|---------------|---------|-------------|
| Automated messages | Guest phone, name, dates | Send check-in, check-out, review messages | Contract performance |
| AI assistant | Guest messages, apartment info | Answer guest questions | Contract performance |
| Escalation handling | Guest messages, phone | Alert host to issues | Contract performance |
| Booking management | Guest name, phone, dates | Manage reservations | Contract performance |
| Messaging | Guest phone, message content | Host-guest communication | Contract performance |

## Data Subjects
- Guests: individuals staying at apartments
- Hosts: individuals managing apartments

## Data Location
All data is stored in the EU (Railway Frankfurt region). Processors may transfer data outside the EU as documented in the processor list.

## Retention Schedule

### Guest Data
- **Guest name, phone, language, notes, messages, scheduled messages**: `owner.retentionDays` (default 90 days) after check-out
- **Booking dates, source, apartment**: kept indefinitely for occupancy history
- **Messages from numbers with no booking**: 30 days
- **Opt-out list (keyed hashes only)**: kept indefinitely

### System Data
- **Login attempts (hashed)**: 7 days
- **Job runs**: 90 days
- **Audit logs (no personal data)**: 1 year
- **Database backups**: 30 days (daily), 12 months (monthly)

## Data Subject Rights

### Right to Access
Guests can request a copy of their personal data from the host. The host can export guest data through the Ostra interface (`/api/export/guest`).

### Right to Rectification
Guests can request correction of inaccurate data. The host can edit booking details through the Ostra interface.

### Right to Erasure
Guests can request deletion of their personal data. The host can erase guest data through the Ostra interface. This deletes guest name, phone, messages, and scheduled messages. Booking dates and apartment details are retained for occupancy history.

### Right to Restrict Processing
Guests can request limitation of processing. The host can pause automatic messages for a booking.

### Right to Object
Guests can object to processing by opting out (replying "STOP" to any message).

### Right to Data Portability
Guests can request a copy of their data in a structured format. The host can export guest data through the Ostra interface.

## Security Measures

### Technical Measures
- Encryption in transit (TLS)
- Encryption at rest (database encryption)
- Access controls (authentication, authorization)
- Input validation and output encoding
- Regular security updates
- Rate limiting and account lockout
- Secure password hashing (bcrypt)
- API signature verification (webhooks, cron jobs)

### Organizational Measures
- Data minimization (only collect necessary data)
- Privacy by design (data deleted after retention period)
- Access logging (audit logs for data operations)
- Incident response procedure
- Staff training (if applicable)
- Data processing agreements with subprocessors

## Breach Procedure

1. **Detection**: Operator detects a potential breach
2. **Containment**: Immediate steps to stop further unauthorized access
3. **Assessment**: Determine scope and risk to data subjects
4. **Notification to Controller**: Operator notifies host without undue delay
5. **Controller Decision**: Host decides whether to notify supervisory authority (within 72 hours of becoming aware)
6. **Data Subject Notification**: If high risk, host notifies affected individuals
7. **Documentation**: Maintain a breach log with:
   - Nature of breach
   - Categories and approximate number of data subjects concerned
   - Likely consequences
   - Measures taken to address breach

A breach log is maintained in the audit log table.

## Subprocessor List

See `/privacy` page for the current list of subprocessors with their purposes, data involved, and regions.

## End of Contract

When a host ends their contract with Ostra:
1. Operator exports all host data (`scripts/export-owner.ts`)
2. Host confirms receipt
3. Operator deletes all host data (`scripts/delete-owner.ts`)
4. Audit log entry recorded
5. Backups are retained according to the backup retention schedule

---

**Note**: This document provides engineering support for GDPR compliance but is not legal advice. Have a Maltese lawyer or the host's adviser review this before processing real guest data.
