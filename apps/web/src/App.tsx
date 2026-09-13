import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import Shell from "./components/Shell";
import { Skeleton } from "./components/ui";
import { api } from "./lib/api";
import type { Owner } from "./lib/types";

import Entries from "./pages/Entries";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import PersonalArea from "./pages/PersonalArea";
import ProjectDetail from "./pages/ProjectDetail";
import Reconcile from "./pages/Reconcile";
import Reports from "./pages/Reports";
import SavingsArea from "./pages/SavingsArea";
import Settings from "./pages/Settings";
import StudioArea from "./pages/StudioArea";

export default function App() {
  const { data: owner, isLoading, isError } = useQuery<Owner>({
    queryKey: ["me"],
    queryFn: () => api.get<Owner>("/auth/me"),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="sheet pt-16">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-8 h-[58px] w-full" />
      </div>
    );
  }

  if (isError || !owner) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/personal" element={<PersonalArea />} />
        <Route path="/studio" element={<StudioArea />} />
        <Route path="/savings" element={<SavingsArea />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/entries" element={<Entries />} />
        <Route path="/reconcile" element={<Reconcile />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
