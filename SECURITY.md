# Security Policy

## Supported Versions

Only the latest version receives security updates. Users are encouraged to upgrade to the latest stable release.


## Reporting a Vulnerability

We take security seriously and appreciate your efforts to responsibly disclose vulnerabilities. If you believe you have found a vulnerability, please follow the guidelines below to submit a report.

### **What to Include in Your Report**
To help us quickly understand and address the issue, please include the following sections in your report:

#### 1. **Summary**
   - A brief description of the vulnerability.

#### 2. **Affected Versions**
   - The version(s) of the project affected by the vulnerability.
   - Example: "Affects versions 3.4.0 to 3.6.23."

#### 3. **Details**
   - A detailed explanation of the vulnerability, including:
     - How to reproduce the issue (step-by-step instructions).
     - The code or component where the vulnerability exists.
     - The expected vs. actual behavior.

#### 4. **Proof of Concept (PoC)**
   - Provide a proof of concept to demonstrate the vulnerability. This could be:
     - Code snippets.
     - Screenshots or videos.
     - A minimal reproducible example.

#### 5. **Patches (if applicable)**
   - If you have a suggested fix or patch, include it in your report.
   - Example: "Sanitize user input using `DOMPurify`."

#### 6. **Impact**
   - Describe the potential impact of the vulnerability, such as:
     - Remote Code Execution.
     - CSRF.
     - Data exposure.
     - Denial of service.



### **What to Expect**
- **Acknowledgement**: You will receive an acknowledgment of your report within **48 hours**.
- **Timeline**: We will provide a timeline for investigating and addressing the issue.
- **Updates**: You will receive regular updates on the progress of the vulnerability resolution.
- **CVE ID**: If the vulnerability is confirmed, we can help you apply for a CVE ID to formally recognize the issue.


### **Out of Scope**
The following issues are considered out of scope for security reports:
- Vulnerabilities in outdated or unsupported versions.
- Issues related to non-security-impacting bugs or feature requests.
- Vulnerabilities requiring physical access to the device or social engineering.



## Security Updates

We are committed to providing timely security updates for supported versions. Here’s our process:
1. **Assessment**:
   - All reported vulnerabilities are assessed for severity and impact.
2. **Patch Development**:
   - Patches are developed and tested in a private repository to prevent premature disclosure.
3. **Release**:
   - Security patches are released as soon as possible, along with a detailed advisory.



## Acknowledgments

We deeply appreciate the efforts of security researchers and users who help us improve the security of our project.



## Contact

For any questions or concerns regarding security, please contact us at `security@yourproject.com`.
