import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ size = 32, className = '' }) => (
  <img
    src="/logo.png"
    alt="Crestward"
    width={size}
    height={size}
    style={{ objectFit: 'contain', display: 'block', mixBlendMode: 'multiply' }}
    className={className}
  />
);

export default Logo;
