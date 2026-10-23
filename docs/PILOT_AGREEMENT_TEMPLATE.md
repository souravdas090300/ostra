# Pilot Agreement Template

**MARKED FOR LEGAL REVIEW - THIS IS A DRAFT**

This Pilot Agreement is entered into between:

**Host:** [Host Name] ("Host")
**Operator:** [Operator Name] ("Operator")

## 1. Parties and Purpose

### 1.1 Purpose
The Operator will provide the Ostra service to the Host for a pilot period. Ostra is a guest communication and booking management tool that:
- Provides a calendar overview across multiple booking platforms (Airbnb, Booking.com, direct bookings)
- Sends automatic WhatsApp messages to guests (check-in, check-out, review requests)
- Provides an AI assistant that answers guest questions from information provided by the Host
- Provides an inbox for messages that the AI assistant cannot answer

### 1.2 Duration
This pilot period is **30 days** from the first live guest message, with review meetings at day 7 and day 30. Either party may end this agreement with **3 days' notice**. After day 30, this pilot ends unless both parties sign a separate paid service agreement.

## 2. What the Operator Provides

### 2.1 Setup and Configuration
- Initial setup of the Host's apartments in Ostra
- Import of iCal feeds from booking platforms
- Configuration of message templates
- One 90-minute onboarding session

### 2.2 Monitoring and Support
- Daily monitoring of system health during the pilot
- Fixes for any bugs or issues
- One weekly check-in meeting (20 minutes)
- Response times for problems:
  - **Critical issues** (messages not sending, AI not answering, wrong answers): within 2 hours between 08:00 and 21:00 Malta time
  - **Other questions**: by the next working day

### 2.3 No Uptime Guarantee
The Operator makes no guarantee of uptime during the pilot period. The Operator will use best efforts to keep the service running, but downtime may occur.

## 3. What the Host Provides

### 3.1 Accurate Information
The Host agrees to:
- Provide accurate apartment information (check-in steps, Wi-Fi, parking, house rules, etc.)
- Keep this information up to date
- Answer escalations promptly (within 4 hours during daytime when possible)

### 3.2 Guest Communication
The Host agrees to:
- Tell guests about WhatsApp messaging and record who agreed to receive messages
- Only send messages to guests who have opted in
- Not use Ostra to send unsolicited marketing messages
- Remain responsible for all communications with guests

### 3.3 Platform Compliance
The Host is responsible for complying with the rules of Airbnb, Booking.com, and WhatsApp. The Operator will keep automated messages practical and requires guest opt-in, but the Host must ensure their use of Ostra complies with platform terms.

## 4. Responsibility for Answers

### 4.1 AI Assistant Limitations
The AI assistant can be wrong. It answers only from the information provided by the Host. If the answer is not in the information, or if the guest reports a problem, emergency, refund, or payment issue, the AI will escalate to the Host.

### 4.2 Host Responsibility
The Host remains responsible for:
- All answers provided to guests, whether by AI or by the Host
- The accuracy of information provided to guests
- All guest interactions and satisfaction

### 4.3 Escalation Rules
Escalation rules exist but the Host must still review escalated messages. The Host should respond to escalations promptly.

### 4.4 Emergencies
Emergencies are handled by the Host and by calling 112 (Malta emergency services), not by the AI assistant. The AI should escalate emergencies immediately.

## 5. Data Protection

### 5.1 Roles
The Host is the **data controller** of guest data. The Operator is the **data processor**. The parties have signed a separate Data Processing Agreement (DPA) which governs data processing.

### 5.2 Processors
The current list of subprocessors is documented in the DPA and on the `/privacy` page of the Ostra service.

### 5.3 Retention
Guest data (name, phone, messages) is deleted **90 days after check-out** unless the Host sets a different period (30-730 days). Booking dates and apartment details are kept indefinitely for occupancy history.

## 6. Costs

### 6.1 Pilot Period
During the 30-day pilot, third-party costs are included up to the following caps:
- WhatsApp messages: [X] template messages per month
- AI usage: [X]€ per month (in tokens)

### 6.2 After Caps
If the Host exceeds these caps during the pilot, costs will be passed through at actual cost:
- WhatsApp messages: [€0.XX per message template, €0.XX per free-form message]
- AI usage: actual Anthropic API costs

### 6.3 After Pilot
After day 30, if the parties continue, costs will be governed by a separate paid service agreement.

## 7. Liability

### 7.1 Cap
The Operator's total liability to the Host is capped at the fees paid by the Host in the last 3 months (or pro-rated for the pilot period).

### 7.2 Exclusions
The Operator is not liable for:
- Loss of bookings or revenue
- Guest complaints or disputes
- Platform suspensions or penalties
- Data loss beyond the Operator's control
- Any indirect or consequential damages

### 7.3 No Guarantee
As stated in section 2.3, there is no uptime guarantee during the pilot.

## 8. Feedback and Testimonial

### 8.1 Honest Feedback
The Host agrees to provide honest feedback about the service during the pilot reviews.

### 8.2 Testimonial
If satisfied with the service, the Host agrees to provide a short testimonial and, if the Host agrees, an anonymised case study. The case study will not include any guest data, and the Host's name will only be included with the Host's explicit permission.

## 9. Exit

### 9.1 Data Export
On ending this agreement, the Operator will export the Host's data on request.

### 9.2 Data Deletion
The Operator will delete the Host's data from Ostra and backups within 30 days of the end of the agreement. Backups expire according to the backup retention schedule (see RUNBOOK.md).

### 9.3 Third-Party Accounts
The Host remains responsible for any third-party accounts (Airbnb, Booking.com, Twilio, etc.) and must cancel or transfer them as needed.

## 10. Signatures

**Host:**
Name: _____________________
Email: _____________________
Date: _____________________

**Operator:**
Name: _____________________
Email: _____________________
Date: _____________________

---

**Note:** This is a template for a pilot agreement. It must be reviewed and adapted by a qualified lawyer before use. This document is marked for legal review and should not be used in its current form for real guest data processing.
