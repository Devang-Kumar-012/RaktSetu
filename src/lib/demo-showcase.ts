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
  /** Most recent first; the first entry is the `lastDonated` one. */
  history: { month: string; place: string; purpose: string }[];
}

export const SAMPLE_DONORS: SampleDonor[] = [
  { name: "Ritika S.", age: 27, bloodGroup: "O+", locality: "Lajpat Nagar, Delhi", donations: 9, lastDonated: "Sep 2026", helpedWith: "Emergency surgery at AIIMS", history: [{ month: "Sep 2026", place: "AIIMS, New Delhi", purpose: "Emergency surgery" }, { month: "May 2026", place: "Red Cross camp, Lajpat Nagar", purpose: "Voluntary donation" }, { month: "Jan 2026", place: "Safdarjung Hospital", purpose: "Road-accident patient" }] },
  { name: "Mohammed A.", age: 34, bloodGroup: "B+", locality: "Indirapuram, Ghaziabad", donations: 4, lastDonated: "Aug 2026", helpedWith: "Dengue patient needing platelets", history: [{ month: "Aug 2026", place: "Max Hospital, Vaishali", purpose: "Dengue patient (platelets)" }, { month: "Apr 2026", place: "Yashoda Hospital, Kaushambi", purpose: "Planned surgery" }, { month: "Nov 2025", place: "Campus drive, ABES Ghaziabad", purpose: "Voluntary donation" }] },
  { name: "Harpreet K.", age: 41, bloodGroup: "A+", locality: "Rajouri Garden, Delhi", donations: 8, lastDonated: "Oct 2026", helpedWith: "Mother after childbirth", history: [{ month: "Oct 2026", place: "Sir Ganga Ram Hospital", purpose: "Mother after childbirth" }, { month: "Jun 2026", place: "BLK-Max Hospital", purpose: "Thalassemia transfusion" }, { month: "Feb 2026", place: "Gurudwara camp, Rajouri Garden", purpose: "Voluntary donation" }] },
  { name: "Aniket V.", age: 23, bloodGroup: "O-", locality: "Sector 62, Noida", donations: 4, lastDonated: "Jul 2026", helpedWith: "Road-accident trauma case", history: [{ month: "Jul 2026", place: "Fortis Hospital, Noida", purpose: "Road-accident trauma" }, { month: "Mar 2026", place: "Campus drive, JIIT Noida", purpose: "Voluntary donation" }, { month: "Oct 2025", place: "District Hospital, Noida", purpose: "Emergency surgery" }] },
  { name: "Sneha P.", age: 29, bloodGroup: "AB+", locality: "Dwarka, Delhi", donations: 6, lastDonated: "Sep 2026", helpedWith: "Thalassemia transfusion", history: [{ month: "Sep 2026", place: "Manipal Hospital, Dwarka", purpose: "Thalassemia transfusion" }, { month: "May 2026", place: "Venkateshwar Hospital", purpose: "Cancer patient" }, { month: "Jan 2026", place: "Red Cross camp, Dwarka", purpose: "Voluntary donation" }] },
  { name: "Rakesh Y.", age: 38, bloodGroup: "B-", locality: "Raj Nagar, Ghaziabad", donations: 1, lastDonated: "Aug 2026", helpedWith: "Cardiac surgery at Max Saket", history: [{ month: "Aug 2026", place: "Max Super Speciality, Saket", purpose: "Cardiac surgery" }] },
  { name: "Divya M.", age: 31, bloodGroup: "A-", locality: "Sector 29, Gurugram", donations: 8, lastDonated: "Oct 2026", helpedWith: "Cancer patient on chemotherapy", history: [{ month: "Oct 2026", place: "Medanta, Gurugram", purpose: "Cancer patient on chemotherapy" }, { month: "Jun 2026", place: "Artemis Hospital", purpose: "Mother after childbirth" }, { month: "Feb 2026", place: "Corporate drive, Cyber City", purpose: "Voluntary donation" }] },
  { name: "Imran Q.", age: 26, bloodGroup: "O+", locality: "Laxmi Nagar, Delhi", donations: 5, lastDonated: "Sep 2026", helpedWith: "Campus drive at Hi-Tech, Ghaziabad", history: [{ month: "Sep 2026", place: "Campus drive, Hi-Tech Ghaziabad", purpose: "Voluntary donation" }, { month: "May 2026", place: "LNJP Hospital", purpose: "Burns patient" }, { month: "Jan 2026", place: "Red Cross camp, Laxmi Nagar", purpose: "Voluntary donation" }] },
];
