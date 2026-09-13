import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import Shell from "./components/Shell";
import { Skeleton } from "./components/ui";
import { api } from "./lib/api";
import type { Owner } from "./lib/types";

import Clients from "./pages/Clients";
import Dashboard from "./pages/Dashboard";
import Expenses from "./pages/Expenses";
import ImportPage from "./pages/Import";
import Login from "./pages/Login";
import Payments from "./pages/Payments";
import Personal from "./pages/Personal";
import ProjectDetail from "./pages/ProjectDetail";
import Projects from "./pages/Projects";
import Reports from "./pages/Reports";
import Review from "./pages/Review";
import Settings from "./pages/Settings";
import Transactions from "./pages/Transactions";

export default function App() {
  const { data: owner, isLoading, isError } = useQuery<Owner>({
    queryKey: ["me"],
    queryFn: () => api.get<Owner>("/auth/me"),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen p-8">
        <Skeleton className="h-9 w-56" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px]" />
          ))}
        </div>
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
        <Route path="/" element={<Dashboard />} />
        <Route path="/review" element={<Review />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/personal" element={<Personal />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
