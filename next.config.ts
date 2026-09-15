import type { NextConfig } from "next";
const securityHeaders=[{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},{key:"Permissions-Policy",value:"camera=(self), microphone=(), geolocation=()"},{key:"Content-Security-Policy",value:"frame-ancestors 'none'"},{key:"Strict-Transport-Security",value:"max-age=31536000; includeSubDomains"}];
const nextConfig:NextConfig={poweredByHeader:false,async headers(){return[{source:"/(.*)",headers:securityHeaders}];}};
export default nextConfig;
