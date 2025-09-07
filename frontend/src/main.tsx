import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Amplify } from "aws-amplify"

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: "us-east-1_AWbZedeID",
      userPoolClientId: "459i1313nvr5s5pn3vhbiubk9t",
      identityPoolId: "us-east-1:c74bd2ea-8672-4242-ba1d-92d42cbb6482",
      loginWith: {
        email: true,
      },
      signUpVerificationMethod: "code",
      userAttributes: {
        email: {
          required: true,
        },
      },
      allowGuestAccess: true,
      passwordFormat: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireNumbers: false,
        requireSpecialCharacters: false,
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
