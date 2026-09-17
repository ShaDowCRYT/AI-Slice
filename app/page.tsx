import { redirect } from "next/navigation";

// This slice has exactly four screens; / is not one of them. Point a bare
// visit at the only starting screen (the upload page), which is proxy-guarded
// and bounces unauthenticated users to /signin.
export default function HomePage() {
  redirect("/upload");
}
