import { redirect } from "next/navigation";

/**
 * /volunteer is the volunteer dashboard. The real page lives at
 * /dashboard/volunteer so role dashboards stay in one place.
 */
export default function VolunteerIndexPage() {
  redirect("/dashboard/volunteer");
}
