import { useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';

/**
 * The first version of the public job link was /careers/<slug> (a page of this app). The careers pages now live at
 * /delphic/career/ and are served by the API as plain HTML, so old links are sent there with a full page load.
 */
export default function CareerRedirect() {
  const { slug } = useParams();
  const { search } = useLocation();
  useEffect(() => {
    window.location.replace(`/delphic/career/${slug ? encodeURIComponent(slug) : ''}${search}`);
  }, [slug, search]);
  return <p className="p-6 text-sm text-tertiary-500">Opening the careers page…</p>;
}
