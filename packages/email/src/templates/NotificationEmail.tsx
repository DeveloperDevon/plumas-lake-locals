import { Body, Container, Head, Heading, Html, Link, Preview, Text } from "@react-email/components";

interface NotificationEmailProps {
  title: string;
  body: string;
  url: string;
}

/**
 * FR-NOT-02: one generic template for every notification type, not eleven bespoke ones - each
 * already renders as "a short line of text + where to go" in the in-app notification center
 * (apps/web's describeNotification/useGoToTarget), so title/body/url covers all of them.
 */
export function NotificationEmail({ title, body, url }: NotificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f6f6f6", padding: "24px" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "32px", borderRadius: "8px" }}>
          <Heading as="h2">{title}</Heading>
          <Text>{body}</Text>
          <Link href={url}>View on Plumas Lake Locals</Link>
          <Text style={{ color: "#888888", fontSize: "12px" }}>
            You can turn this off in Settings &gt; Notifications.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default NotificationEmail;
