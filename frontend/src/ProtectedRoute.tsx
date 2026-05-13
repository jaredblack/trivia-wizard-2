import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { Outlet } from "react-router-dom";
import type { AuthUser } from "aws-amplify/auth";
import Header from "./components/layout/Header";

export type AuthOutletContext = {
  user: AuthUser | undefined;
  signOut?: () => void;
};

export default function ProtectedRoute() {
  return (
    <Authenticator
      components={{
        Header: () => <Header />,
      }}
    >
      {({ signOut, user }) => (
        <Outlet context={{ user, signOut } satisfies AuthOutletContext} />
      )}
    </Authenticator>
  );
}
