import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

import { CustomThemeProvider } from "@/components/custom-theme-provider";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Check authentication before rendering the layout
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  return (
    <CustomThemeProvider>
      <div className="h-screen bg-background">{children}</div>
    </CustomThemeProvider>
  );
}
