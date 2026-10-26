import styles from './UserSendFailure.module.css';

export function UserSendFailure({ message }: { message: string }) {
  return <p className={styles.reason} role="alert" data-testid="user-send-failure-reason">{message}</p>;
}
