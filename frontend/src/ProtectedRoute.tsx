import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { Outlet } from "react-router-dom";
import type { AuthUser } from "aws-amplify/auth";
import { isLocalMode } from "./config";
import LocalAuthProvider from "./LocalAuthProvider";

export type AuthOutletContext = {
  user: AuthUser | undefined;
  signOut?: () => void;
};

export default function ProtectedRoute() {
  if (isLocalMode) {
    return <LocalAuthProvider />;
  }

  return (
    <Authenticator>
      {({ signOut, user }) => (
        <main>
          <Outlet context={{ user, signOut } satisfies AuthOutletContext} />
        </main>
      )}
    </Authenticator>
  );
}
