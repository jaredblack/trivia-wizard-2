
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { Outlet } from "react-router-dom";
import type { AuthUser } from "aws-amplify/auth";

export type AuthOutletContext = {
  user: AuthUser | undefined;
  signOut?: () => void;
};

export default function ProtectedRoute() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <main>
          {/* The Outlet will render the nested child route,
                passing down the user and signOut function */}
          <Outlet context={{ user, signOut } satisfies AuthOutletContext} />
        </main>
      )}
    </Authenticator>
  );
}
