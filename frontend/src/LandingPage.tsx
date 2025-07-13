
import React from 'react';
import { Link } from 'react-router-dom';

const LandingPage: React.FC = () => {
  return (
    <div style={{ textAlign: 'center', paddingTop: '50px' }}>
      <h1 style={{ fontWeight: 'bold', fontSize: '3rem' }}>Trivia Wizard</h1>
      <Link to="/authenticate">
        <button 
          style={{ 
            backgroundColor: 'blue', 
            color: 'white', 
            padding: '10px 20px', 
            border: 'none', 
            borderRadius: '5px', 
            cursor: 'pointer' 
          }}
        >
          Get started
        </button>
      </Link>
    </div>
  );
};

export default LandingPage;
