/**
 * Sample donor profiles for the homepage while the platform has no recorded
 * donations of its own (pilot / demo). They are ILLUSTRATIVE, not real people,
 * and the homepage labels them as samples. As soon as an admin records a real
 * donation, the homepage shows the real (anonymous) history instead.
 */

export interface SampleDonor {
  name: string; // first name + last initial, the same privacy rule real donors get
  age: number;
  bloodGroup: string;
  locality: string;
  donations: number;
  lastDonated: string; // month, e.g. "Sep 2026"
  helpedWith: string;
}

export const SAMPLE_DONORS: SampleDonor[] = [
  { name: "Ritika S.", age: 27, bloodGroup: "O+", locality: "Lajpat Nagar, Delhi", donations: 9, lastDonated: "Sep 2026", helpedWith: "Emergency surgery at AIIMS" },
  { name: "Mohammed A.", age: 34, bloodGroup: "B+", locality: "Indirapuram, Ghaziabad", donations: 14, lastDonated: "Aug 2026", helpedWith: "Dengue patient needing platelets" },
  { name: "Harpreet K.", age: 41, bloodGroup: "A+", locality: "Rajouri Garden, Delhi", donations: 22, lastDonated: "Oct 2026", helpedWith: "Mother after childbirth" },
  { name: "Aniket V.", age: 23, bloodGroup: "O-", locality: "Sector 62, Noida", donations: 4, lastDonated: "Jul 2026", helpedWith: "Road-accident trauma case" },
  { name: "Sneha P.", age: 29, bloodGroup: "AB+", locality: "Dwarka, Delhi", donations: 6, lastDonated: "Sep 2026", helpedWith: "Thalassemia transfusion" },
  { name: "Rakesh Y.", age: 38, bloodGroup: "B-", locality: "Raj Nagar, Ghaziabad", donations: 17, lastDonated: "Aug 2026", helpedWith: "Cardiac surgery at Max Saket" },
  { name: "Divya M.", age: 31, bloodGroup: "A-", locality: "Sector 29, Gurugram", donations: 8, lastDonated: "Oct 2026", helpedWith: "Cancer patient on chemotherapy" },
  { name: "Imran Q.", age: 26, bloodGroup: "O+", locality: "Laxmi Nagar, Delhi", donations: 5, lastDonated: "Sep 2026", helpedWith: "Campus drive at Hi-Tech, Ghaziabad" },
];
