import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";


export default function App() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Authenticator>
          {({ signOut, user }) => (
            <main className="text-center">
              <h1 className="text-2xl font-bold">Hello {user?.username}</h1>
              <button
                onClick={signOut}
                className="mt-4 px-4 py-2 font-semibold text-white bg-blue-500 rounded hover:bg-blue-600"
              >
                Sign out
              </button>
              <h1 className="mt-8 text-xl">The page</h1>
            </main>
          )}
        </Authenticator>
    </div>
  );
}
