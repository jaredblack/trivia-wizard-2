import { Outlet } from "react-router-dom";
import type { AuthOutletContext } from "./ProtectedRoute";

const mockUser = {
  username: "LocalTestUser",
  userId: "local-test-123",
};

const mockSignOut = () => {
  console.log("Mock sign out called (local mode)");
};

export default function LocalAuthProvider() {
  return (
    <main>
      <Outlet context={{ user: mockUser, signOut: mockSignOut } satisfies AuthOutletContext} />
    </main>
  );
}
