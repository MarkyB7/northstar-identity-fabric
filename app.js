require("dotenv").config();

const express = require("express");
const session = require("express-session");
const { ConfidentialClientApplication } = require("@azure/msal-node");

const app = express();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

const msalConfig = {
  auth: {
    clientId: process.env.CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.CLIENT_SECRET,
  },
};

const cca = new ConfidentialClientApplication(msalConfig);
const securityEvents = [];

function recordSecurityEvent(req, eventType, severity, details = {}) {
  const user = req.session?.user;

  const event = {
    timestamp: new Date().toISOString(),
    eventType,
    severity,
    user: user?.name || "Anonymous",
    username: user?.preferred_username || user?.email || user?.upn || "Unknown",
    tenantId: user?.tid || "Unknown",
    route: req.originalUrl,
    method: req.method,
    sourceIp: req.ip,
    userAgent: req.get("user-agent") || "Unknown",
    ...details,
  };

  securityEvents.unshift(event);

  if (securityEvents.length > 50) {
    securityEvents.pop();
  }

  console.log(JSON.stringify(event));
}
function logAccess(user, route, allowed) {
  console.log(
    `[${new Date().toISOString()}] User: ${user?.name || "Unknown"} | Route: ${route} | Allowed: ${allowed}`
  );
}
const authCodeUrlParameters = {
  scopes: ["openid", "profile", "email"],
  redirectUri: process.env.REDIRECT_URI,
};

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

function requireRole(roleName) {
  return (req, res, next) => {
    if (!req.session.user) {
      recordSecurityEvent(req, "AUTH_REQUIRED", "LOW", {
        decision: "Redirected",
        reason: "User not authenticated",
        requiredRole: roleName,
      });

      return res.redirect("/");
    }

    const user = req.session.user;
    const roles = user.roles || [];
    const allowed = roles.includes(roleName);

    recordSecurityEvent(
      req,
      allowed ? "AUTHZ_ACCESS_ALLOWED" : "AUTHZ_ACCESS_DENIED",
      allowed ? "LOW" : "MEDIUM",
      {
        decision: allowed ? "Allowed" : "Denied",
        requiredRole: roleName,
        userRoles: roles,
      }
    );

    if (!allowed) {
      return res.status(403).send(`
        <h1>Access Denied</h1>
        <p>You are signed in, but you do not have the required role: <strong>${roleName}</strong></p>
        <p>Your roles: ${roles.length ? roles.join(", ") : "None"}</p>
        <a href="/">Go back</a>
      `);
    }

    next();
  };
}

app.get("/", (req, res) => {
  if (!req.session.user) {
    return res.send(`
      <h1>Northstar SSO App</h1>
      <p>Not signed in</p>
      <a href="/login">Sign in with Microsoft Entra ID</a>
    `);
  }

  const user = req.session.user;
  const roles = user.roles || [];

  res.send(`
    <h1>Northstar SSO App</h1>
    <p><strong>Signed in as:</strong> ${user.name || "Unknown"}</p>
    <p><strong>Email / Username:</strong> ${user.preferred_username || user.email || user.upn || "Unknown"}</p>
    <p><strong>Tenant ID:</strong> ${user.tid || "Unknown"}</p>
    <p><strong>Roles:</strong> ${roles.length ? roles.join(", ") : "None"}</p>
    <p><a href="/profile">Profile</a></p>
    <p><a href="/security">Security Admin Page</a></p>
    <p><a href="/logout">Logout</a></p>
  `);
});

app.get("/profile", requireAuth, (req, res) => {
  const user = req.session.user;
  res.send(`
    <h1>User Profile</h1>
    <p><strong>Name:</strong> ${user.name || "Unknown"}</p>
    <p><strong>Email / Username:</strong> ${user.preferred_username || user.email || user.upn || "Unknown"}</p>
    <p><strong>Roles:</strong> ${(user.roles || []).join(", ") || "None"}</p>
    <a href="/">Home</a>
  `);
});

app.get("/security", requireRole("SecurityAdmin"), (req, res) => {
  res.send(`
    <h1>Security Admin Page</h1>
    <p>Welcome. You are authorized for protected security functions.</p>
    <ul>
      <li>View security audit dashboard</li>
      <li>Review privileged access requests</li>
      <li>Inspect IAM policy changes</li>
    </ul>
    <a href="/">Home</a>
  `);
});

app.get("/dashboard", requireRole("SecurityAdmin"), (req, res) => {
  recordSecurityEvent(req, "SECURITY_DASHBOARD_VIEWED", "LOW", {
    decision: "Allowed",
  });

  const rows = securityEvents
    .map(
      (event) => `
        <tr>
          <td>${event.timestamp}</td>
          <td>${event.eventType}</td>
          <td>${event.severity}</td>
          <td>${event.user}</td>
          <td>${event.username}</td>
          <td>${event.route}</td>
          <td>${event.decision || "N/A"}</td>
        </tr>
      `
    )
    .join("");

  res.send(`
    <h1>Security Event Dashboard</h1>
    <p>Recent authentication and authorization events.</p>

    <table border="1" cellpadding="8" cellspacing="0">
      <thead>
        <tr>
          <th>Time</th>
          <th>Event Type</th>
          <th>Severity</th>
          <th>User</th>
          <th>Username</th>
          <th>Route</th>
          <th>Decision</th>
        </tr>
      </thead>
      <tbody>
        ${rows || "<tr><td colspan='7'>No security events yet</td></tr>"}
      </tbody>
    </table>

    <p><a href="/">Home</a></p>
  `);
});

app.get("/login", async (req, res) => {
  try {
    const authCodeUrl = await cca.getAuthCodeUrl(authCodeUrlParameters);
    res.redirect(authCodeUrl);
  } catch (error) {
    console.error("Error generating auth URL:", error);
    res.status(500).send("Failed to start login flow.");
  }
});

app.get("/redirect", async (req, res) => {
  if (!req.query.code) {
    return res.status(400).send("No authorization code returned.");
  }

  const tokenRequest = {
    code: req.query.code,
    scopes: ["openid", "profile", "email"],
    redirectUri: process.env.REDIRECT_URI,
  };

  try {
    const response = await cca.acquireTokenByCode(tokenRequest);
    req.session.user = response.account.idTokenClaims;

    recordSecurityEvent(req, "AUTH_LOGIN_SUCCESS", "LOW", {
      decision: "Allowed",
      authProvider: "Microsoft Entra ID",
    });

res.redirect("/");
  } catch (error) {
    console.error("Token acquisition error:", error);
    res.status(500).send("Authentication failed.");
  }
});

app.get("/logout", (req, res) => {
  recordSecurityEvent(req, "AUTH_LOGOUT", "LOW", {
    decision: "Completed",
  });

  req.session.destroy(() => {
    const logoutUrl =
      `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/logout` +
      `?post_logout_redirect_uri=http://localhost:3000`;
    res.redirect(logoutUrl);
  });
});

app.listen(3000, "0.0.0.0", () => {
  console.log("App running at http://localhost:3000");
});
