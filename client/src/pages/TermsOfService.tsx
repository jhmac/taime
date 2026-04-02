export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <button onClick={() => window.history.back()} className="text-primary">
          <i className="fas fa-chevron-left text-lg"></i>
        </button>
        <h1 className="text-lg font-bold">Terms of Service</h1>
        <div className="w-6"></div>
      </div>

      <div className="px-4 py-6 max-w-2xl mx-auto space-y-6 text-sm text-foreground">
        <p className="text-muted-foreground">Last updated: April 2, 2026</p>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">1. Acceptance of Terms</h2>
          <p>
            By accessing or using the MAinager platform ("Service"), you agree to be bound by these Terms of
            Service ("Terms"). If you do not agree to these Terms, you may not use the Service. These Terms
            apply to all users, including business owners, managers, and employees who access the platform.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">2. Description of Service</h2>
          <p>
            MAinager is a SaaS workforce management platform that provides tools for scheduling, time tracking,
            payroll reporting, communications, task management, and store operations analytics. The Service may
            integrate with third-party platforms such as Shopify to provide additional functionality.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">3. Use of the Service</h2>
          <p>You agree to use the Service only for lawful purposes and in accordance with these Terms. You agree not to:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Use the Service to violate any applicable law or regulation</li>
            <li>Attempt to gain unauthorized access to any part of the Service</li>
            <li>Transmit any harmful, offensive, or disruptive content</li>
            <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
            <li>Use automated means to access the Service without prior written consent</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">4. Accounts and Access</h2>
          <p>
            Access to the Service is granted through an organization account. The account owner is responsible
            for maintaining the security of login credentials and for all activity that occurs under their
            account. Employees invited to an organization account are subject to the permissions assigned by
            the account administrator.
          </p>
          <p>
            You must provide accurate information when setting up your account and keep that information
            up to date. We reserve the right to suspend or terminate accounts found to be in violation of
            these Terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">5. Employee Data</h2>
          <p>
            The Service collects and stores employee-related data including names, contact information, work
            schedules, attendance records, performance data, and payroll information, as directed by the
            organization. Organization administrators are responsible for ensuring they have the appropriate
            legal basis to collect and process this data in their jurisdiction.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">6. Third-Party Integrations</h2>
          <p>
            The Service may integrate with third-party platforms, including Shopify, Clerk (authentication),
            Anthropic (AI features), and Nylas (calendar and email). Your use of these integrations is also
            governed by the respective third parties' terms of service. We are not responsible for the
            availability or conduct of third-party services.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">7. Intellectual Property</h2>
          <p>
            All content, features, and functionality of the Service — including software, text, graphics,
            and logos — are the exclusive property of MAinager and are protected by applicable intellectual
            property laws. You are granted a limited, non-exclusive, non-transferable license to use the
            Service solely as described in these Terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">8. Subscription and Payment</h2>
          <p>
            Access to certain features of the Service may require a paid subscription. Subscription fees are
            billed in advance and are non-refundable except as required by law. We reserve the right to
            change pricing with reasonable advance notice. Failure to pay subscription fees may result in
            suspension or termination of access to the Service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">9. Termination</h2>
          <p>
            Either party may terminate this agreement at any time. We reserve the right to suspend or
            terminate your access to the Service immediately, without prior notice, for conduct that we
            believe violates these Terms or is harmful to other users, us, or third parties. Upon termination,
            your right to use the Service will immediately cease.
          </p>
          <p>
            Upon account closure, your data will be retained for a period of 30 days and then deleted,
            unless a longer retention period is required by law.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">10. Limitation of Liability</h2>
          <p>
            To the fullest extent permitted by applicable law, MAinager shall not be liable for any indirect,
            incidental, special, consequential, or punitive damages, including loss of profits, data, or
            goodwill, arising out of or in connection with your use or inability to use the Service. In no
            event shall our total liability to you exceed the amount paid by you for the Service in the
            twelve months preceding the event giving rise to the claim.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">11. Disclaimer of Warranties</h2>
          <p>
            The Service is provided "as is" and "as available" without warranties of any kind, either
            express or implied, including but not limited to implied warranties of merchantability, fitness
            for a particular purpose, and non-infringement. We do not warrant that the Service will be
            uninterrupted, error-free, or free of viruses or other harmful components.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">12. Changes to Terms</h2>
          <p>
            We reserve the right to modify these Terms at any time. We will notify you of material changes
            by posting the updated Terms and updating the "last updated" date. Continued use of the Service
            after such changes constitutes your acceptance of the new Terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">13. Governing Law</h2>
          <p>
            These Terms shall be governed by and construed in accordance with applicable laws, without regard
            to conflict of law principles. Any disputes arising from these Terms or the Service shall be
            resolved through binding arbitration or in a court of competent jurisdiction.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">14. Contact</h2>
          <p>
            If you have any questions about these Terms, please contact us through the Support section of the
            application.
          </p>
        </section>
      </div>
    </div>
  );
}
