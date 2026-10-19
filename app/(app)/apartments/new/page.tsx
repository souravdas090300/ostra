import { ApartmentForm, EMPTY_APARTMENT } from "@/components/ApartmentForm";
import { createApartment } from "../actions";

export default function NewApartmentPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Add apartment</h1>
      <ApartmentForm action={createApartment} values={EMPTY_APARTMENT} submitLabel="Create apartment" />
    </div>
  );
}
