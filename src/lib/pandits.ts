/**
 * A curated roster of respected-sounding Vedic astrologer (Pandit) display
 * names, each with an honorific. One is assigned at checkout so the customer's
 * report and delivery email are attributed to a personal astrologer.
 *
 * These are illustrative brand personas for the service, not real individuals.
 */
export const PANDITS: readonly string[] = [
  'Dr. Abhijit Dubey',
  'Pandit Rakesh Shastri',
  'Acharya Vinod Sharma',
  'Jyotishacharya Suresh Trivedi',
  'Pandit Mahesh Chandra Joshi',
  'Dr. Anil Kumar Tripathi',
  'Acharya Ramesh Pandey',
  'Pandit Devendra Nath Mishra',
  'Guru Shivprasad Vyas',
  'Dr. Krishna Murthy Shastri',
  'Pandit Yogesh Bhardwaj',
  'Acharya Girish Chaturvedi',
];

/** Pick a random Pandit display name to attribute a report to. */
export function randomPandit(): string {
  return PANDITS[Math.floor(Math.random() * PANDITS.length)];
}
