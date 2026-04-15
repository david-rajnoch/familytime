/**
 * Displays a face crop thumbnail fetched from /api/files/face/{face_id}/thumbnail.
 * Falls back to a placeholder on error.
 */
interface Props {
  faceId: number
  size?: number
  className?: string
  style?: React.CSSProperties
}

export function FaceThumbnail({ faceId, size = 80, className, style }: Props) {
  return (
    <img
      src={`/api/files/face/${faceId}/thumbnail`}
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'cover', borderRadius: 'inherit', ...style }}
      onError={(e) => {
        ;(e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><rect width='100%25' height='100%25' fill='%23242429'/><text x='50%25' y='55%25' font-size='${Math.floor(size * 0.5)}' text-anchor='middle' dominant-baseline='middle' fill='%23555'>?</text></svg>`
      }}
      alt=""
    />
  )
}
