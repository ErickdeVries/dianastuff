import { LandingPage } from "@/src/components/landing-page";

// Route "/" = halaman depan (landing). Pengunjung login diarahkan oleh
// root-layout gate ke etalase; tamu melihat landing ini.
export default function Index() {
  return <LandingPage />;
}
