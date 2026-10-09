# Participant feedback — October 9, 2026

Source: feedback provided by Isaac Fox. These are requested improvements, not completed features.

## Jared

GitHub issue: [Add product details for battery health, condition, and included accessories](https://github.com/ikefoxy/isaac-business-startup/issues/1)

## Participant feedback
Jared (Developer) liked the consistent colors, typography, and product filters. He requested detailed product views showing battery health, condition, and included accessories.

## Change
Give shoppers a product detail view before reservation, while preserving the existing visual style and filters.

## Acceptance criteria
- [ ] Each catalog item opens a clear, accessible detail view.
- [ ] Show verified battery health when available; otherwise explicitly show “Not yet verified” or “Not applicable.”
- [ ] Show the device condition and a plain-language explanation of that condition.
- [ ] List included accessories, including whether a charger is supplied.
- [ ] Keep reference photos and demo data clearly identified; do not invent inspection results.
- [ ] Keep the reservation action visible and preserve active catalog filters when returning.

## Verification
Check a verified item and an item with missing information on desktop and mobile. Verify keyboard navigation, return-to-catalog behavior, and reservation.

Source: participant feedback supplied by Isaac Fox on October 9, 2026.

## Joe

GitHub issue: [Clarify Add device and reservation sign-in, and tighten catalog spacing](https://github.com/ikefoxy/isaac-business-startup/issues/2)

## Participant feedback
Joe (Developer) liked the donation progress indicator and review screen. He requested clearer “Add device” instructions, clearer reservation sign-in wording, and less empty space above catalog search results.

## Change
Make the next action obvious in the donation and reservation flows, and bring catalog results closer to the search controls. Preserve the existing donation progress and review screen.

## Acceptance criteria
- [ ] Explain what to select or enter before using Add device, and confirm when a device joins the donation list.
- [ ] Distinguish adding another device from continuing to the next donation step.
- [ ] When a signed-out shopper reserves a computer, explain why sign-in is needed and how the email link works.
- [ ] Preserve the selected computer through sign-in and return the shopper to reservation.
- [ ] Reduce unnecessary space between filters/search and results without crowding controls.

## Verification
Add one device and then a second. Reserve while signed out and return through the sign-in link. Check catalog spacing at mobile and desktop widths, including empty search results.

Source: participant feedback supplied by Isaac Fox on October 9, 2026.

## Katrina

GitHub issue: [Show original price, applied reward, and final amount due at pickup](https://github.com/ikefoxy/isaac-business-startup/issues/3)

## Participant feedback
Katrina (Accountant) liked visible prices and the payment-at-pickup explanation. She requested an explicit breakdown of original price, applied reward, and final amount owed, such as $179 − $20 in rewards = $159 due.

## Change
Show a consistent price breakdown before reservation confirmation and in the saved reservation/receipt.

## Acceptance criteria
- [ ] Show the listed price, reward actually applied, and final amount due at pickup together.
- [ ] For the example $179 device with an eligible $20 reward, show $179 − $20 = $159 due at pickup.
- [ ] Use the validated server-side reward amount; do not promise a discount before eligibility is confirmed.
- [ ] Handle no reward, rejected reward, free devices, and rewards capped by the item price; the final amount cannot be negative.
- [ ] Keep “No online payment; pay at pickup” visible.
- [ ] Use the same amounts on confirmation, saved reservation, and receipt.

## Verification
Exercise full reward, no reward, invalid reward, and a device priced below the reward amount. Verify the displayed arithmetic matches server-side totals.

Source: participant feedback supplied by Isaac Fox on October 9, 2026.

## Cory

GitHub issue: [Clarify donor eligibility, device handoff, and inspection steps](https://github.com/ikefoxy/isaac-business-startup/issues/4)

## Participant feedback
Cory (Boss) liked ByteBack’s purpose and the separate shopping and donation paths. He requested clarity about who can donate, how handoff works, and how devices are inspected.

## Change
Add short, specific guidance to the donation entry point and relevant steps, while keeping shopping and donation paths distinct.

## Acceptance criteria
- [ ] Clearly state who may donate and which devices are accepted, using rules confirmed by the organizer.
- [ ] Explain the handoff options, what the donor needs to prepare, and what happens after submission.
- [ ] Use only a verified drop-off location and hours; clearly identify demo handoff information.
- [ ] Explain inspection, verified data erasure, refurbishment, and listing readiness in plain language.
- [ ] Distinguish the donor’s data-wipe pledge from organizer-verified processing.
- [ ] Keep the academic/demo status clear and avoid implying a physical service is operating before it is confirmed.

## Verification
A first-time visitor can answer “Can I donate?”, “How do I hand it over?”, and “What happens to it?” before submitting. Compare the copy against the organizer’s confirmed process and the app’s actual stages.

Source: participant feedback supplied by Isaac Fox on October 9, 2026.
