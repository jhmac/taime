export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <button onClick={() => window.history.back()} className="text-primary">
          <i className="fas fa-chevron-left text-lg"></i>
        </button>
        <h1 className="text-lg font-bold">Privacy Policy</h1>
        <div className="w-6"></div>
      </div>

      <div className="px-4 py-6 max-w-2xl mx-auto space-y-6 text-sm text-foreground">
        <p className="text-muted-foreground">Last updated: April 2, 2026</p>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">1. Introduction</h2>
          <p>
            MAinager ("we", "us", or "our") is committed to protecting the privacy of your information.
            This Privacy Policy describes how we collect, use, disclose, and safeguard information when
            you use our workforce management platform. Please read this policy carefully. By using the
            Service, you consent to the practices described here.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">2. Information We Collect</h2>
          <p>We collect the following categories of information:</p>

          <h3 className="font-medium mt-3">Account and Organization Data</h3>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Business name, contact details, and billing information</li>
            <li>Account credentials managed through Clerk authentication</li>
            <li>Organization settings and configuration preferences</li>
          </ul>

          <h3 className="font-medium mt-3">Employee Data</h3>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Names, email addresses, phone numbers, and job roles</li>
            <li>Work schedules, shift assignments, and availability preferences</li>
            <li>Time and attendance records, including clock-in and clock-out timestamps</li>
            <li>Performance records, notes, and evaluations created by managers</li>
            <li>Pay rates and payroll-related data (as entered by organization administrators)</li>
            <li>Training records and certifications</li>
          </ul>

          <h3 className="font-medium mt-3">Location Data</h3>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Device location at the time of clock-in and clock-out events, if location-based attendance tracking is enabled by the organization</li>
            <li>Location data is used solely to verify attendance and is not shared with third parties for advertising purposes</li>
          </ul>

          <h3 className="font-medium mt-3">Shopify Store Data</h3>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Sales reports, transaction summaries, and product performance data retrieved from connected Shopify stores</li>
            <li>Store configuration settings required to display operational dashboards</li>
            <li>We access only the Shopify data necessary to provide the analytics and reporting features of the Service</li>
          </ul>

          <h3 className="font-medium mt-3">Usage Data</h3>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Log data, including IP addresses, browser type, and pages visited within the Service</li>
            <li>Device information and crash/error reports used to improve reliability</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">3. How We Use Your Information</h2>
          <p>We use collected information to:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Provide, operate, and maintain the Service</li>
            <li>Enable workforce scheduling, time tracking, payroll reporting, and communications features</li>
            <li>Generate analytics dashboards and operational reports</li>
            <li>Power AI-assisted features using Anthropic's API (message content sent to AI is not used to train third-party models)</li>
            <li>Send transactional notifications and alerts related to your account</li>
            <li>Detect, investigate, and prevent fraudulent or unauthorized activity</li>
            <li>Comply with legal obligations</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">4. How We Share Your Information</h2>
          <p>
            We do not sell your personal information. We may share information with third parties only in
            the following circumstances:
          </p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li><strong>Service providers:</strong> We share data with trusted vendors who help us operate the Service, including Clerk (authentication), Anthropic (AI features), Nylas (calendar and email integration), and SendGrid (transactional email). These providers are contractually bound to handle data securely and only as instructed.</li>
            <li><strong>Shopify:</strong> When you connect a Shopify store, data is exchanged between the Service and Shopify according to Shopify's API terms.</li>
            <li><strong>Legal requirements:</strong> We may disclose information if required by law, court order, or government authority.</li>
            <li><strong>Business transfers:</strong> In the event of a merger, acquisition, or sale of assets, user data may be transferred as part of that transaction.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">5. Employee Data and Employer Responsibilities</h2>
          <p>
            Organization administrators act as data controllers for the employee data they enter into the
            platform. MAinager acts as a data processor on their behalf. Employers are responsible for:
          </p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Obtaining any necessary consent from employees to collect and process their data</li>
            <li>Complying with applicable employment and data protection laws in their jurisdiction</li>
            <li>Maintaining the accuracy of employee records within the platform</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">6. Push Notification Tokens</h2>
          <p>
            To deliver shift reminders, schedule changes, and workplace alerts, we store a push notification
            token tied to your device and account. These tokens are provided by Apple (APNs) or Google (FCM)
            and are used solely to route notifications to your device. Push tokens are automatically removed
            from our systems after 90 days of device inactivity. You can revoke notification permission at
            any time in your device settings, which will prevent further notifications.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">7. Data Retention</h2>
          <p>
            We retain data for as long as your account is active or as needed to provide the Service.
            Upon account closure, data is retained for 30 days before deletion, unless a longer period
            is required by law. Location check-in records are retained for payroll and compliance purposes
            for up to 3 years. Push notification tokens are removed after 90 days of inactivity.
            You may request earlier deletion by contacting us at{" "}
            <a href="mailto:support@taime.us" className="underline">support@taime.us</a>.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">8. Data Security</h2>
          <p>
            We implement industry-standard security measures to protect your data, including encryption
            in transit (TLS) and at rest, access controls, and regular security monitoring. However,
            no method of transmission or storage is 100% secure, and we cannot guarantee absolute security.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">9. Your Rights</h2>
          <p>Depending on your jurisdiction, you may have the right to:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your data (subject to legal retention obligations)</li>
            <li>Object to or restrict certain processing activities</li>
            <li>Data portability where technically feasible</li>
          </ul>
          <p className="mt-2">
            To exercise any of these rights, contact us through the Support section of the application.
            Employees wishing to access or correct their data should contact their organization administrator
            in the first instance.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">10. Children's Privacy</h2>
          <p>
            The Service is not directed to individuals under the age of 16. We do not knowingly collect
            personal information from minors. If you believe a minor's data has been provided to us,
            please contact support so we can take appropriate action.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">11. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material changes
            by updating the date at the top of this page. Continued use of the Service after changes
            are posted constitutes your acceptance of the updated policy.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">12. Contact Us</h2>
          <p>
            If you have questions or concerns about this Privacy Policy or our data practices, please
            contact us:
          </p>
          <p className="mt-2">
            <strong>Email:</strong>{" "}
            <a href="mailto:support@taime.us" className="underline">support@taime.us</a>
            <br />
            <strong>Website:</strong>{" "}
            <a href="https://taime.us/support" className="underline">taime.us/support</a>
          </p>
        </section>
      </div>
    </div>
  );
}
